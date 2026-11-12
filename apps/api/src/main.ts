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
import { AppModule } from "./app.module";
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
  app.useBodyParser("json", { limit: "9mb" });
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
    .setVersion("0.1.0")
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
