import { Controller, Get, Header } from "@nestjs/common";
import { settingsSnapshot } from "./settings";

// Explicit allowlist: public disclosures must never expose integration credentials
// or the internal server configuration, even when new settings are added.
@Controller("public")
export class PublicInfoController {
  @Get("info")
  @Header("Cache-Control", "no-store")
  async info() {
    const { values, updatedAt } = await settingsSnapshot();
    const companyName = String(values.companyName || "TuinWerk"),
      supportEmail = String(values.supportEmail || ""),
      privacyContactEmail = String(values.privacyContactEmail || ""),
      privacyRetentionDescription = String(
        values.privacyRetentionDescription || "",
      );
    return {
      companyName,
      supportEmail,
      privacyContactEmail,
      privacyRetentionDescription,
      updatedAt,
      ready: !!(
        supportEmail &&
        privacyContactEmail &&
        privacyRetentionDescription
      ),
    };
  }
}
