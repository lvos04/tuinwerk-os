import { startRuntimeSettings } from "./settings";
import "reflect-metadata";
import { NestExpressApplication } from "@nestjs/platform-express";
import { NestFactory } from "@nestjs/core";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import { json } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppModule } from "./app.module";
/**
 * JSON-routes die meer dan de standaardlimiet nodig hebben: imports met een
 * base64-bestand (CSV/XLSX tot 6 MB) en het bevestigen van een telling (tot
 * 10.000 regels). Bijlagen en back-uparchieven gaan via multipart (eigen limiet).
 */
export const LARGE_JSON_ROUTES = [
  /^\/api\/imports\/preview\/?$/,
  /^\/api\/imports\/catalog\/preview\/?$/,
  /^\/api\/inventory\/counts\/[^/]+\/confirm\/?$/,
];
/** TRUST_PROXY: leeg = "loopback"; "false"/"0" = uit; getal = aantal hops; anders lijst van adressen/subnetten. */
export function trustProxySetting(value: string | undefined) {
  const v = (value ?? "").trim();
  if (!v) return "loopback";
  if (["false", "0", "off", "nee"].includes(v.toLowerCase())) return false;
  if (["true", "on", "ja"].includes(v.toLowerCase())) return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
export function appVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf8"),
    ).version as string;
  } catch {
    return "onbekend";
  }
}
@Catch()
class Errors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException)
      return res
        .status(e.getStatus())
        .json(
          typeof e.getResponse() === "string"
            ? { message: e.message }
            : e.getResponse(),
        );
    if (["22P02", "23503", "23514", "22007", "22008"].includes(e.code))
      return res
        .status(400)
        .json({ message: "Ongeldige gegevens of verwijzing" });
    if (e.code === "23505")
      return res.status(409).json({
        message: "Dit record bestaat al of er is al een actieve timer",
      });
    console.error(
      JSON.stringify({ level: "error", message: e.message, code: e.code }),
    );
    res.status(500).json({ message: "Interne fout; probeer later opnieuw" });
  }
}
export async function createApp() {
  const stopSettings = await startRuntimeSettings();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Vertrouwde proxy voor X-Forwarded-For (aanmeldbeperking per IP). Standaard
  // alleen loopback: de gebundelde nginx in de container draait op 127.0.0.1.
  app.set("trust proxy", trustProxySetting(process.env.TRUST_PROXY));
  // Kleine standaardlimiet; alleen imports (base64-bestand in JSON) mogen groter.
  const largeJson = json({ limit: process.env.JSON_LARGE_BODY_LIMIT || "9mb" });
  const smallJson = json({ limit: process.env.JSON_BODY_LIMIT || "1mb" });
  app.use((req: any, res: any, next: any) =>
    (LARGE_JSON_ROUTES.some((r) => r.test(req.path)) ? largeJson : smallJson)(
      req,
      res,
      next,
    ),
  );
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err?.type === "entity.too.large")
      return res.status(413).json({ message: "Aanvraag is te groot" });
    if (err?.type === "entity.parse.failed")
      return res.status(400).json({ message: "Ongeldige JSON" });
    next(err);
  });
  app.useBodyParser("urlencoded", { limit: "100kb", extended: false });
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.enableCors({
    origin: (origin, callback) => {
      const allowed = (process.env.CORS_ORIGINS || "")
        .split(",")
        .filter(Boolean);
      if (process.env.APP_URL) {
        try {
          allowed.push(new URL(process.env.APP_URL).origin);
        } catch {}
      }
      callback(null, !origin || allowed.includes(origin));
    },
  });
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  const config = new DocumentBuilder()
    .setTitle("TuinWerk OS API")
    .setDescription(
      "Geauthenticeerde API; zie docs/API.md voor mutatievelden en offline protocol.",
    )
    .setVersion(appVersion())
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, config),
  );
  const close = app.close.bind(app);
  app.close = async () => {
    stopSettings();
    await close();
  };
  await app.init();
  return app;
}
if (require.main === module)
  createApp().then((app) =>
    app.listen(Number(process.env.PORT) || 3001, "0.0.0.0"),
  );
