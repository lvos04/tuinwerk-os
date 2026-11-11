import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Response } from "express";
import { AuthGuard, CurrentUser, User } from "./auth";
import { query, camel, audit } from "./db";
import { idempotent, uuid } from "./core";
const dir = resolve(process.env.UPLOAD_DIR || "uploads");
function detect(b: Buffer) {
  if (b.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  throw new BadRequestException(
    "Alleen JPEG, PNG, WebP en PDF zijn toegestaan",
  );
}
@Controller("attachments")
@UseGuards(AuthGuard)
export class AttachmentsController {
  @Get() async list(@Query() q: any) {
    if (!q.taskId && !q.assetId)
      throw new BadRequestException("Taak of machine verplicht");
    return camel(
      await query(
        "SELECT id,task_id,asset_id,uploaded_by,name,mime_type,size,hash,phase,annotation,version,created_at FROM attachments WHERE " +
          (q.taskId ? "task_id" : "asset_id") +
          "=$1 ORDER BY created_at",
        [uuid(q.taskId || q.assetId)],
      ),
    );
  }
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        fileSize: Number(process.env.MAX_UPLOAD_BYTES) || 10485760,
        files: 1,
        fields: 10,
      },
    }),
  )
  async upload(
    @CurrentUser() u: User,
    @Body() b: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("Bestand verplicht");
    if (!b.taskId && !b.assetId)
      throw new BadRequestException("Taak of machine verplicht");
    if (b.taskId) uuid(b.taskId);
    if (b.assetId) uuid(b.assetId);
    const mime = detect(file.buffer),
      digest = createHash("sha256").update(file.buffer).digest("hex");
    const operation = { ...b, fileHash: digest, fileName: file.originalname };
    return idempotent(u, operation, "attachments:create", async (c) => {
      if (b.taskId) {
        const [t] = (
          await c.query("SELECT status FROM tasks WHERE id=$1 FOR SHARE", [
            b.taskId,
          ])
        ).rows;
        if (!t) throw new NotFoundException();
        if (t.status === "archived")
          throw new ConflictException(
            "Taak gearchiveerd; bestand blijft lokaal voor herstel",
          );
      }
      const storageName = randomUUID();
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, storageName), file.buffer, {
        flag: "wx",
        mode: 0o600,
      });
      try {
        const [r] = (
          await c.query(
            "INSERT INTO attachments(task_id,asset_id,uploaded_by,name,storage_name,mime_type,size,hash,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,task_id,asset_id,name,mime_type,size,hash,phase,created_at",
            [
              b.taskId || null,
              b.assetId || null,
              u.id,
              file.originalname.slice(0, 255),
              storageName,
              mime,
              file.size,
              digest,
              ["before", "during", "after"].includes(b.phase)
                ? b.phase
                : "during",
            ],
          )
        ).rows;
        await audit(c, u.id, "attachment", r.id, "uploaded");
        return camel(r);
      } catch (e) {
        await unlink(resolve(dir, storageName));
        throw e;
      }
    });
  }
  @Get(":id/file") async file(@Param("id") id: string, @Res() res: Response) {
    const [r] = await query("SELECT * FROM attachments WHERE id=$1", [
      uuid(id),
    ]);
    if (!r) throw new NotFoundException();
    res.setHeader("Content-Type", r.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`,
    );
    res.sendFile(resolve(dir, r.storage_name));
  }
  @Post(":id/annotation") async annotate(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    if (
      !b.annotation ||
      typeof b.annotation !== "object" ||
      JSON.stringify(b.annotation).length > 100000
    )
      throw new BadRequestException("Annotatie te groot");
    return idempotent(u, b, "annotation:" + id, async (c) => {
      const [r] = (
        await c.query(
          "UPDATE attachments SET annotation=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING id,annotation,version",
          [JSON.stringify(b.annotation), uuid(id), b.version],
        )
      ).rows;
      if (!r)
        throw new ConflictException(
          "Bijlage gewijzigd; laad de huidige versie",
        );
      await audit(c, u.id, "attachment", id, "annotated");
      return r;
    });
  }
}
