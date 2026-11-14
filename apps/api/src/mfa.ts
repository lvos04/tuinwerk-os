import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  AuthGuard,
  AdminGuard,
  CurrentUser,
  User,
  passwordMatches,
  hash,
} from "./auth";
import { query, transaction, audit } from "./db";
import { base32, encryptSecret, decryptSecret, verifyTotp } from "./totp";
@Controller("auth/mfa")
@UseGuards(AuthGuard, AdminGuard)
export class MfaController {
  @Get() async status(@CurrentUser() u: User) {
    const [r] = await query("SELECT mfa_enabled FROM users WHERE id=$1", [
      u.id,
    ]);
    return {
      enabled: r.mfa_enabled,
      available: true,
    };
  }
  @Post("setup") async setup(@CurrentUser() u: User, @Body() b: any) {
    const [r] = await query(
      "SELECT password_hash,mfa_enabled FROM users WHERE id=$1",
      [u.id],
    );
    if (!passwordMatches(String(b.password || ""), r.password_hash))
      throw new UnauthorizedException("Wachtwoord onjuist");
    if (r.mfa_enabled)
      throw new BadRequestException("Schakel huidige tweede factor eerst uit");
    const secret = base32(randomBytes(20));
    let encrypted: string;
    try {
      encrypted = encryptSecret(secret);
    } catch {
      throw new ServiceUnavailableException(
        "Versleutelde configuratieopslag is niet beschikbaar",
      );
    }
    await query("UPDATE users SET mfa_pending_secret=$1 WHERE id=$2", [
      encrypted,
      u.id,
    ]);
    return {
      secret,
      uri: `otpauth://totp/${encodeURIComponent("TuinWerk OS:" + u.email)}?secret=${secret}&issuer=TuinWerk%20OS&algorithm=SHA1&digits=6&period=30`,
    };
  }
  @Post("enable") async enable(@CurrentUser() u: User, @Body() b: any) {
    return transaction(async (c) => {
      const [r] = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [u.id])
      ).rows;
      if (!r.mfa_pending_secret || r.mfa_enabled)
        throw new BadRequestException("Start eerst de configuratie");
      const step = verifyTotp(decryptSecret(r.mfa_pending_secret), b.otp);
      if (step === null) throw new BadRequestException("Code onjuist");
      const recoveryCodes = Array.from({ length: 10 }, () =>
        randomBytes(12).toString("hex"),
      );
      await c.query(
        "UPDATE users SET mfa_secret=mfa_pending_secret,mfa_pending_secret=NULL,mfa_enabled=true,mfa_last_step=$1,mfa_recovery_hashes=$2 WHERE id=$3",
        [step, recoveryCodes.map(hash), u.id],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [
        u.id,
        (u as any).session_id,
      ]);
      await audit(c, u.id, "user", u.id, "mfa_enabled");
      return {
        recoveryCodes,
        message: "Bewaar deze herstelcodes veilig; elke code werkt één keer.",
      };
    });
  }
  @Post("disable") async disable(@CurrentUser() u: User, @Body() b: any) {
    return transaction(async (c) => {
      const [r] = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [u.id])
      ).rows;
      if (!passwordMatches(String(b.password || ""), r.password_hash))
        throw new UnauthorizedException("Wachtwoord onjuist");
      if (r.mfa_enabled) {
        const step = verifyTotp(decryptSecret(r.mfa_secret), b.otp);
        const recovery =
          typeof b.otp === "string" &&
          r.mfa_recovery_hashes.includes(hash(b.otp));
        if ((step === null || step <= Number(r.mfa_last_step)) && !recovery)
          throw new BadRequestException("Code onjuist of al gebruikt");
      }
      await c.query(
        "UPDATE users SET mfa_enabled=false,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_last_step=NULL,mfa_recovery_hashes='{}' WHERE id=$1",
        [u.id],
      );
      await audit(c, u.id, "user", u.id, "mfa_disabled");
      return { enabled: false };
    });
  }
}
