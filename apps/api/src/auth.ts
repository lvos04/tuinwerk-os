import { decryptSecret, verifyTotp } from "./totp";
import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { query, transaction, camel, audit } from "./db";
export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "employee";
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw new BadRequestException("Gebruik een wachtwoord van 12–256 tekens");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string) {
  try {
    const [salt, key] = stored.split(":");
    return timingSafeEqual(
      Buffer.from(key, "hex"),
      scryptSync(password, salt, 64),
    );
  } catch {
    return false;
  }
}
export const CurrentUser = createParamDecorator(
  (_data: any, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedException("Log opnieuw in");
    const [u] = await query(
      "SELECT u.id,u.email,u.name,u.role,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
      [hash(token)],
    );
    if (!u) throw new UnauthorizedException("Sessie verlopen");
    req.user = u;
    return true;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    if (ctx.switchToHttp().getRequest().user?.role !== "admin")
      throw new ForbiddenException("Alleen voor beheerders");
    return true;
  }
}
const attempts = new Map<string, { count: number; until: number }>();
async function issue(userId: string, device: string, c?: any) {
  const token = randomBytes(32).toString("base64url"),
    refreshToken = randomBytes(48).toString("base64url");
  await (c ? c.query.bind(c) : query)(
    "INSERT INTO sessions(user_id,token_hash,refresh_hash,device,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '30 days')",
    [userId, hash(token), hash(refreshToken), device.slice(0, 200)],
  );
  return { token, refreshToken };
}
@Controller("auth")
export class AuthController {
  @Post("login") async login(@Body() b: any, @Req() req: any) {
    if (
      typeof b.email !== "string" ||
      typeof b.password !== "string" ||
      b.password.length > 256
    )
      throw new UnauthorizedException("Ongeldige inloggegevens");
    const key = req.ip + ":" + b.email.toLowerCase();
    const a = attempts.get(key);
    if (a && a.until > Date.now() && a.count >= 10)
      throw new ForbiddenException("Te veel pogingen; probeer over 15 minuten");
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (v.until < Date.now()) attempts.delete(k);
    attempts.set(key, {
      count: (a && a.until > Date.now() ? a.count : 0) + 1,
      until: Date.now() + 900000,
    });
    const [u] = await query(
      "SELECT * FROM users WHERE lower(email)=$1 AND active=true",
      [b.email.toLowerCase()],
    );
    if (!u || !passwordMatches(b.password, u.password_hash))
      throw new UnauthorizedException("Ongeldige inloggegevens");
    return transaction(async (c) => {
      const [fresh] = (
        await c.query(
          "SELECT * FROM users WHERE id=$1 AND active=true FOR UPDATE",
          [u.id],
        )
      ).rows;
      if (!fresh || !passwordMatches(b.password, fresh.password_hash))
        throw new UnauthorizedException(
          "Inloggegevens gewijzigd; probeer opnieuw",
        );
      if (fresh.mfa_enabled) {
        if (!b.otp)
          throw new UnauthorizedException({
            message: "Tweede factor vereist",
            mfaRequired: true,
          });
        const step = verifyTotp(decryptSecret(fresh.mfa_secret), b.otp);
        const recovery =
          typeof b.otp === "string" &&
          fresh.mfa_recovery_hashes.includes(hash(b.otp));
        if ((step === null || step <= Number(fresh.mfa_last_step)) && !recovery)
          throw new UnauthorizedException(
            "Tweede factor onjuist of al gebruikt",
          );
        await c.query(
          "UPDATE users SET mfa_last_step=$1,mfa_recovery_hashes=$2 WHERE id=$3",
          [
            recovery ? fresh.mfa_last_step : step,
            recovery
              ? fresh.mfa_recovery_hashes.filter(
                  (x: string) => x !== hash(b.otp),
                )
              : fresh.mfa_recovery_hashes,
            u.id,
          ],
        );
      }
      const result = {
        ...(await issue(
          u.id,
          typeof b.device === "string" ? b.device : "Web",
          c,
        )),
        user: {
          id: fresh.id,
          email: fresh.email,
          name: fresh.name,
          role: fresh.role,
        },
      };
      attempts.delete(key);
      return result;
    });
  }
  @Post("refresh") async refresh(@Body() b: any) {
    if (typeof b.refreshToken !== "string") throw new UnauthorizedException();
    const [session] = await query(
      "SELECT user_id FROM sessions WHERE refresh_hash=$1",
      [hash(b.refreshToken)],
    );
    if (!session) throw new UnauthorizedException("Sessie verlopen");
    return transaction(async (c) => {
      const [user] = (
        await c.query(
          "SELECT id FROM users WHERE id=$1 AND active=true FOR UPDATE",
          [session.user_id],
        )
      ).rows;
      if (!user) throw new UnauthorizedException();
      const { rows } = await c.query(
        "DELETE FROM sessions WHERE refresh_hash=$1 AND refresh_expires_at>now() AND user_id IN(SELECT id FROM users WHERE active=true) RETURNING user_id,device",
        [hash(b.refreshToken)],
      );
      if (!rows[0]) throw new UnauthorizedException("Sessie verlopen");
      const token = randomBytes(32).toString("base64url"),
        refreshToken = randomBytes(48).toString("base64url");
      await c.query(
        "INSERT INTO sessions(user_id,token_hash,refresh_hash,device,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '30 days')",
        [rows[0].user_id, hash(token), hash(refreshToken), rows[0].device],
      );
      return { token, refreshToken };
    });
  }
  @Get("me") @UseGuards(AuthGuard) me(@CurrentUser() u: User) {
    return u;
  }
  @Get("sessions") @UseGuards(AuthGuard) async sessions(
    @CurrentUser() u: User,
  ) {
    return camel(
      await query(
        "SELECT id,device,created_at,expires_at FROM sessions WHERE user_id=$1",
        [u.id],
      ),
    );
  }
  @Delete("sessions/:id") @UseGuards(AuthGuard) async revoke(
    @CurrentUser() u: User,
    @Param("id") id: string,
  ) {
    await query("DELETE FROM sessions WHERE id=$1 AND user_id=$2", [id, u.id]);
    return { ok: true };
  }
  @Post("logout") @UseGuards(AuthGuard) async logout(@CurrentUser() u: any) {
    await query("DELETE FROM sessions WHERE id=$1", [u.session_id]);
    return { ok: true };
  }
}
@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  @Get() async list() {
    return camel(
      await query(
        "SELECT id,email,name,role,active FROM users WHERE NOT system_account ORDER BY name",
      ),
    );
  }
  @Post() @UseGuards(AdminGuard) async create(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    if (
      !b.email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      !["admin", "employee"].includes(b.role)
    )
      throw new BadRequestException(
        "Naam, geldig e-mailadres en rol verplicht",
      );
    return transaction(async (c) => {
      const { rows } = await c.query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,name,role",
        [
          b.email.toLowerCase(),
          b.name.trim(),
          passwordHash(b.password),
          b.role,
        ],
      );
      await audit(c, u.id, "user", rows[0].id, "created");
      return rows[0];
    });
  }
  @Patch(":id") @UseGuards(AdminGuard) async update(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
      throw new BadRequestException("Ongeldige gebruiker");
    if (
      b.name !== undefined &&
      (typeof b.name !== "string" || !b.name.trim() || b.name.length > 200)
    )
      throw new BadRequestException("Naam moet 1–200 tekens bevatten");
    if (b.role !== undefined && !["admin", "employee"].includes(b.role))
      throw new BadRequestException("Ongeldige rol");
    if (b.active !== undefined && typeof b.active !== "boolean")
      throw new BadRequestException("Actief moet ja/nee zijn");
    if (id === u.id && b.active === false)
      throw new BadRequestException("Eigen account niet deactiveren");
    const newHash = b.password === undefined ? null : passwordHash(b.password);
    return transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('user-administration'))",
      );
      const actor = (
        await c.query("SELECT role,active FROM users WHERE id=$1 FOR SHARE", [
          u.id,
        ])
      ).rows[0];
      if (!actor?.active || actor.role !== "admin")
        throw new ForbiddenException("Alleen voor beheerders");
      const old = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!old || old.system_account)
        throw new NotFoundException("Gebruiker niet gevonden");
      const role = b.role ?? old.role,
        active = b.active ?? old.active;
      if (old.role === "admin" && old.active && (role !== "admin" || !active)) {
        const { rows } = await c.query(
          "SELECT count(*)::integer AS count FROM users WHERE active=true AND role='admin'",
        );
        if (rows[0].count <= 1)
          throw new BadRequestException(
            "Er moet minimaal één actieve beheerder blijven",
          );
      }
      const [row] = (
        await c.query(
          "UPDATE users SET name=$1,role=$2,active=$3,password_hash=$4 WHERE id=$5 RETURNING id,email,name,role,active",
          [
            b.name?.trim() ?? old.name,
            role,
            active,
            newHash ?? old.password_hash,
            id,
          ],
        )
      ).rows;
      if (newHash || role !== old.role || !active)
        await c.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(c, u.id, "user", id, "updated", {
        before: { name: old.name, role: old.role, active: old.active },
        after: { name: row.name, role: row.role, active: row.active },
        passwordChanged: !!newHash,
      });
      return row;
    });
  }
  @Post(":id/deactivate") @UseGuards(AdminGuard) async deactivate(
    @CurrentUser() u: User,
    @Param("id") id: string,
  ) {
    await this.update(u, id, { active: false });
    return { ok: true };
  }
}
