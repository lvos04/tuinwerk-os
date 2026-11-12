import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { AuthGuard, CurrentUser, User } from "./auth";
import { audit, camel, query, transaction } from "./db";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value: any, name = "ID"): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new BadRequestException(`${name} is ongeldig`);
  return value;
}
function amount(value: any, allowNegative = false): number {
  const n = Number(value);
  if (
    value == null ||
    value === "" ||
    !Number.isFinite(n) ||
    Math.abs(n) > 1e11 ||
    (!allowNegative && n < 0) ||
    Math.abs(n * 10000 - Math.round(n * 10000)) > 0.0001
  )
    throw new BadRequestException(
      "Aantal moet een geldig getal met maximaal vier decimalen zijn",
    );
  return n;
}
function title(value: any): string {
  if (typeof value !== "string" || !value.trim() || value.length > 250)
    throw new BadRequestException("Naam is verplicht (maximaal 250 tekens)");
  return value.trim();
}
async function compatibleAssets(c: PoolClient, value: any) {
  if (!Array.isArray(value) || value.length > 1000)
    throw new BadRequestException("Ongeldige machinecompatibiliteit");
  for (const id of value) validId(id);
  const unique = [...new Set(value)];
  if (
    unique.length &&
    (await c.query("SELECT id FROM assets WHERE id=ANY($1::uuid[])", [unique]))
      .rowCount !== unique.length
  )
    throw new BadRequestException("Onbekende compatibele machine");
  return unique;
}
const hash = (value: any) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function lockOperation(
  c: PoolClient,
  userId: string,
  operationId: string,
  request: any,
) {
  validId(operationId, "Operatie-ID");
  const requestHash = hash(request);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    userId + operationId,
  ]);
  const old = (
    await c.query(
      "SELECT * FROM inventory_operations WHERE user_id=$1 AND operation_id=$2",
      [userId, operationId],
    )
  ).rows[0];
  if (old && old.request_hash !== requestHash)
    throw new ConflictException(
      "Operatie-ID is al gebruikt voor een andere mutatie",
    );
  return { old: old?.result, requestHash };
}
async function balance(c: PoolClient, itemId: string, locationId: string) {
  await c.query(
    "INSERT INTO inventory_balances(item_id,location_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [itemId, locationId],
  );
  return (
    await c.query(
      "SELECT * FROM inventory_balances WHERE item_id=$1 AND location_id=$2 FOR UPDATE",
      [itemId, locationId],
    )
  ).rows[0];
}
async function writeDelta(
  c: PoolClient,
  b: any,
  delta: number,
  userId: string,
  operationId: string,
  type: string,
  reason: string,
  taskId: string | null,
  countId: string | null = null,
) {
  const result = (
    await c.query(
      "UPDATE inventory_balances SET quantity=quantity+$3,version=version+1 WHERE item_id=$1 AND location_id=$2 AND quantity+$3>=0 RETURNING *",
      [b.item_id, b.location_id, delta],
    )
  ).rows[0];
  if (!result)
    throw new ConflictException({
      message:
        "Onvoldoende voorraad; kies een ander aantal of andere opslaglocatie",
      available: Number(b.quantity),
      itemId: b.item_id,
      locationId: b.location_id,
    });
  const movement = (
    await c.query(
      "INSERT INTO inventory_movements(operation_id,item_id,location_id,type,delta,quantity_after,reason,task_id,count_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        operationId,
        b.item_id,
        b.location_id,
        type,
        delta,
        result.quantity,
        reason,
        taskId,
        countId,
        userId,
      ],
    )
  ).rows[0];
  return camel(movement);
}
export async function bookMovement(userId: string, input: any) {
  const itemId = validId(input.itemId),
    locationId = validId(input.locationId),
    operationId = validId(input.operationId);
  const type = input.type;
  if (!["receipt", "usage", "transfer", "correction"].includes(type))
    throw new BadRequestException("Onbekend mutatietype");
  const quantity = amount(input.quantity, type === "correction");
  if (quantity === 0) throw new BadRequestException("Aantal mag niet nul zijn");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (type === "correction" && !reason)
    throw new BadRequestException("Reden is verplicht bij correctie");
  const toLocationId = type === "transfer" ? validId(input.toLocationId) : null;
  if (toLocationId === locationId)
    throw new BadRequestException("Kies twee verschillende opslaglocaties");
  const taskId = input.taskId ? validId(input.taskId) : null;
  const request = {
    itemId,
    locationId,
    operationId,
    type,
    quantity,
    reason,
    toLocationId,
    taskId,
  };
  return transaction(async (c) => {
    const { old, requestHash } = await lockOperation(
      c,
      userId,
      operationId,
      request,
    );
    if (old) return old;
    const item = (
      await c.query(
        "SELECT * FROM inventory_items WHERE id=$1 AND active=true FOR SHARE",
        [itemId],
      )
    ).rows[0];
    if (!item)
      throw new NotFoundException("Artikel niet gevonden of gearchiveerd");
    for (const id of [locationId, ...(toLocationId ? [toLocationId] : [])]) {
      const found = (
        await c.query(
          "SELECT id FROM locations WHERE id=$1 AND active=true FOR SHARE",
          [id],
        )
      ).rows[0];
      if (!found)
        throw new BadRequestException("Opslaglocatie is niet beschikbaar");
    }
    if (taskId) {
      const task = (
        await c.query(
          "SELECT id FROM tasks WHERE id=$1 AND NOT moderation_hidden AND status NOT IN ('archived','cancelled') FOR SHARE",
          [taskId],
        )
      ).rows[0];
      if (!task) throw new BadRequestException("Taak niet beschikbaar");
    }
    // Global deterministic locking prevents opposing transfers from deadlocking.
    const balances: Record<string, any> = {};
    for (const id of [
      locationId,
      ...(toLocationId ? [toLocationId] : []),
    ].sort())
      balances[id] = await balance(c, itemId, id);
    const movements = [
      await writeDelta(
        c,
        balances[locationId],
        type === "usage" || type === "transfer" ? -quantity : quantity,
        userId,
        operationId,
        type,
        reason,
        taskId,
      ),
    ];
    if (toLocationId)
      movements.push(
        await writeDelta(
          c,
          balances[toLocationId],
          quantity,
          userId,
          operationId,
          type,
          reason,
          taskId,
        ),
      );
    const result = { operationId, movements };
    await c.query(
      "INSERT INTO inventory_operations(user_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4)",
      [userId, operationId, requestHash, JSON.stringify(result)],
    );
    await audit(c, userId, "inventory", itemId, type, result);
    return result;
  });
}

@Controller("inventory")
@UseGuards(AuthGuard)
export class InventoryController {
  @Get("items") async items(
    @Query("q") q = "",
    @Query("limit") limit = "100",
    @Query("offset") offset = "0",
  ) {
    const take = Math.min(500, Math.max(1, Number(limit) || 100)),
      skip = Math.max(0, Number(offset) || 0);
    return camel(
      await query(
        `SELECT i.*,COALESCE(sum(b.quantity),0) AS quantity,(COALESCE(sum(b.quantity),0)<i.minimum OR COALESCE(bool_or(b.minimum IS NOT NULL AND b.quantity<b.minimum),false)) AS low_stock FROM inventory_items i LEFT JOIN inventory_balances b ON b.item_id=i.id WHERE i.active AND (i.name ILIKE $1 OR i.sku ILIKE $1) GROUP BY i.id ORDER BY i.name LIMIT $2 OFFSET $3`,
        ["%" + q + "%", take, skip],
      ),
    );
  }
  @Post("items") async create(@Body() b: any, @CurrentUser() u: User) {
    return transaction(async (c) => {
      const compatible = await compatibleAssets(c, b.compatibleAssetIds ?? []);
      const item = (
        await c.query(
          "INSERT INTO inventory_items(sku,name,description,category,unit,minimum,price,supplier,supplier_sku,compatible_asset_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            title(b.sku),
            title(b.name),
            b.description || "",
            b.category || "",
            title(b.unit || "stuk"),
            amount(b.minimum ?? 0),
            b.price == null ? null : amount(b.price),
            b.supplier || "",
            b.supplierSku || "",
            JSON.stringify(compatible),
          ],
        )
      ).rows[0];
      await audit(c, u.id, "inventory_item", item.id, "created");
      return camel(item);
    });
  }
  @Patch("items/:id") async edit(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    if (b.active !== undefined && typeof b.active !== "boolean")
      throw new BadRequestException("Actief moet ja/nee zijn");
    return transaction(async (c) => {
      const old = (
        await c.query("SELECT * FROM inventory_items WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException();
      if (old.version !== b.version)
        throw new ConflictException({
          message: "Artikel is gewijzigd",
          current: camel(old),
        });
      const compatible = await compatibleAssets(
        c,
        b.compatibleAssetIds ?? old.compatible_asset_ids,
      );
      const item = (
        await c.query(
          "UPDATE inventory_items SET name=$2,sku=$3,unit=$4,minimum=$5,description=$6,category=$7,supplier=$8,price=$9,active=$10,compatible_asset_ids=$11,supplier_sku=$12,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            id,
            title(b.name ?? old.name),
            title(b.sku ?? old.sku),
            title(b.unit ?? old.unit),
            amount(b.minimum ?? old.minimum),
            b.description ?? old.description,
            b.category ?? old.category,
            b.supplier ?? old.supplier,
            b.price === undefined
              ? old.price
              : b.price === null
                ? null
                : amount(b.price),
            b.active ?? old.active,
            JSON.stringify(compatible),
            b.supplierSku ?? old.supplier_sku,
          ],
        )
      ).rows[0];
      await audit(c, u.id, "inventory_item", id, "updated");
      return camel(item);
    });
  }
  @Get("balances") async balances(
    @Query("itemId") itemId?: string,
    @Query("limit") limit = "1000",
    @Query("offset") offset = "0",
  ) {
    if (itemId) validId(itemId);
    return camel(
      await query(
        "SELECT b.*,b.quantity<COALESCE(b.minimum,0) AS low_stock,i.name,i.sku,l.name AS location_name FROM inventory_balances b JOIN inventory_items i ON i.id=b.item_id JOIN locations l ON l.id=b.location_id WHERE ($1::uuid IS NULL OR b.item_id=$1) ORDER BY i.name,l.name LIMIT $2 OFFSET $3",
        [
          itemId || null,
          Math.min(1000, Math.max(1, Number(limit) || 1000)),
          Math.max(0, Number(offset) || 0),
        ],
      ),
    );
  }
  @Get("movements") async movements(
    @Query("itemId") itemId?: string,
    @Query("taskId") taskId?: string,
    @Query("limit") limit = "500",
    @Query("offset") offset = "0",
  ) {
    if (itemId) validId(itemId);
    if (taskId) validId(taskId);
    return camel(
      await query(
        "SELECT m.*,i.name AS item_name,l.name AS location_name,u.name AS user_name FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id JOIN locations l ON l.id=m.location_id JOIN users u ON u.id=m.created_by WHERE ($1::uuid IS NULL OR item_id=$1) AND ($2::uuid IS NULL OR task_id=$2) ORDER BY m.created_at DESC LIMIT $3 OFFSET $4",
        [
          itemId || null,
          taskId || null,
          Math.min(1000, Math.max(1, Number(limit) || 500)),
          Math.max(0, Number(offset) || 0),
        ],
      ),
    );
  }
  @Post("movements") move(@Body() b: any, @CurrentUser() u: User) {
    return bookMovement(u.id, b);
  }
  @Get("counts") async counts() {
    return camel(
      await query(
        "SELECT * FROM inventory_counts ORDER BY created_at DESC LIMIT 100",
      ),
    );
  }
  @Post("counts") async startCount(@Body() b: any, @CurrentUser() u: User) {
    if (b.locationId) validId(b.locationId);
    return transaction(async (c) => {
      const count = (
        await c.query(
          "INSERT INTO inventory_counts(name,location_id,created_by) VALUES($1,$2,$3) RETURNING *",
          [title(b.name), b.locationId || null, u.id],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO inventory_count_lines(count_id,item_id,location_id,snapshot_quantity,snapshot_version) WITH RECURSIVE scope AS (SELECT id FROM locations WHERE id=$2 UNION ALL SELECT l.id FROM locations l JOIN scope s ON l.parent_id=s.id) SELECT $1,item_id,location_id,quantity,version FROM inventory_balances WHERE ($2::uuid IS NULL OR location_id IN (SELECT id FROM scope))",
        [count.id, b.locationId || null],
      );
      await audit(c, u.id, "inventory_count", count.id, "started");
      return camel(count);
    });
  }
  @Get("counts/:id") async count(@Param("id") id: string) {
    validId(id);
    const count = (
      await query("SELECT * FROM inventory_counts WHERE id=$1", [id])
    )[0];
    if (!count) throw new NotFoundException();
    const lines = await query(
      "SELECT l.*,b.quantity AS current_quantity,b.version AS current_version,i.name,i.sku,loc.name AS location_name FROM inventory_count_lines l JOIN inventory_balances b USING(item_id,location_id) JOIN inventory_items i ON i.id=l.item_id JOIN locations loc ON loc.id=l.location_id WHERE count_id=$1 ORDER BY i.name",
      [id],
    );
    const movements = await query(
      "SELECT m.* FROM inventory_movements m JOIN inventory_count_lines l ON l.item_id=m.item_id AND l.location_id=m.location_id WHERE l.count_id=$1 AND m.created_at>$2 ORDER BY m.created_at",
      [id, count.created_at],
    );
    return camel({ ...count, lines, movementsDuringCount: movements });
  }
  @Post("counts/:id/lines") async addCountLine(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    validId(b.itemId);
    validId(b.locationId);
    return transaction(async (c) => {
      const count = (
        await c.query("SELECT * FROM inventory_counts WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!count) throw new NotFoundException();
      if (count.status !== "draft")
        throw new ConflictException("Telronde is al bevestigd");
      if (count.version !== b.version)
        throw new ConflictException("Telronde is gewijzigd");
      if (count.location_id) {
        const scope = (
          await c.query(
            "WITH RECURSIVE scope AS (SELECT id FROM locations WHERE id=$1 UNION ALL SELECT l.id FROM locations l JOIN scope s ON l.parent_id=s.id) SELECT id FROM scope WHERE id=$2",
            [count.location_id, b.locationId],
          )
        ).rows;
        if (!scope.length)
          throw new BadRequestException(
            "Opslaglocatie valt buiten deze telronde",
          );
      }
      const current = await balance(c, b.itemId, b.locationId);
      const added = await c.query(
        "INSERT INTO inventory_count_lines(count_id,item_id,location_id,snapshot_quantity,snapshot_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [id, b.itemId, b.locationId, current.quantity, current.version],
      );
      if (added.rowCount) {
        await c.query(
          "UPDATE inventory_counts SET version=version+1 WHERE id=$1",
          [id],
        );
        await audit(c, u.id, "inventory_count", id, "line_added", {
          itemId: b.itemId,
          locationId: b.locationId,
        });
      }
      return camel(
        (await c.query("SELECT * FROM inventory_counts WHERE id=$1", [id]))
          .rows[0],
      );
    });
  }
  @Patch("balances/:itemId/:locationId") async minimum(
    @Param("itemId") itemId: string,
    @Param("locationId") locationId: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(itemId);
    validId(locationId);
    return transaction(async (c) => {
      const current = await balance(c, itemId, locationId);
      if (current.version !== b.version)
        throw new ConflictException({
          message: "Voorraad is gewijzigd",
          current: camel(current),
        });
      const minimum = b.minimum === null ? null : amount(b.minimum);
      const result = (
        await c.query(
          "UPDATE inventory_balances SET minimum=$3,version=version+1 WHERE item_id=$1 AND location_id=$2 RETURNING *",
          [itemId, locationId, minimum],
        )
      ).rows[0];
      await audit(c, u.id, "inventory", itemId, "minimum_updated", {
        locationId,
        minimum,
      });
      return camel(result);
    });
  }
  @Post("counts/:id/confirm") async confirm(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 10000)
      throw new BadRequestException("Geef de getelde regels op");
    return transaction(async (c) => {
      const count = (
        await c.query("SELECT * FROM inventory_counts WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!count) throw new NotFoundException();
      if (count.status === "confirmed") return camel(count);
      if (count.version !== b.version)
        throw new ConflictException("Telronde is gewijzigd");
      const expected = (
        await c.query("SELECT * FROM inventory_count_lines WHERE count_id=$1", [
          id,
        ])
      ).rows;
      const keys = new Set(
        b.lines.map((l: any) => l.itemId + ":" + l.locationId),
      );
      if (keys.size !== b.lines.length || expected.length !== b.lines.length)
        throw new BadRequestException("Vul iedere telregel precies eenmaal in");
      const operationId = randomUUID();
      for (const line of [...b.lines].sort((a: any, z: any) =>
        (a.itemId + a.locationId).localeCompare(z.itemId + z.locationId),
      )) {
        validId(line.itemId);
        validId(line.locationId);
        const quantity = amount(line.quantity);
        if (
          !expected.some(
            (e: any) =>
              e.item_id === line.itemId && e.location_id === line.locationId,
          )
        )
          throw new BadRequestException("Onbekende telregel");
        const current = await balance(c, line.itemId, line.locationId);
        if (current.version !== line.expectedVersion)
          throw new ConflictException({
            message:
              "Voorraad is tijdens de telling gewijzigd; controleer opnieuw",
            itemId: line.itemId,
            locationId: line.locationId,
            currentQuantity: Number(current.quantity),
            currentVersion: current.version,
          });
        const delta = Number((quantity - Number(current.quantity)).toFixed(4));
        if (delta)
          await writeDelta(
            c,
            current,
            delta,
            u.id,
            operationId,
            "correction",
            "Inventarisatie: " + count.name,
            null,
            id,
          );
        await c.query(
          "UPDATE inventory_count_lines SET counted_quantity=$4 WHERE count_id=$1 AND item_id=$2 AND location_id=$3",
          [id, line.itemId, line.locationId, quantity],
        );
      }
      const result = (
        await c.query(
          "UPDATE inventory_counts SET status='confirmed',confirmed_at=now(),version=version+1 WHERE id=$1 RETURNING *",
          [id],
        )
      ).rows[0];
      await audit(c, u.id, "inventory_count", id, "confirmed");
      return camel(result);
    });
  }
}
