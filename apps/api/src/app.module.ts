import { BackupsController } from "./backups";
import { IntegrationsController } from "./integrations";
import { ProductivityController } from "./productivity";
import { PublicInfoController } from "./public-info";
import { AccountPrivacyController } from "./account-privacy";
import { ModerationController } from "./moderation";
import { OneDriveController } from "./onedrive";
import { SettingsController, SetupController } from "./settings";
import { MfaController } from "./mfa";
import { CatalogImportController } from "./catalog-import";
import { WorkspaceController } from "./workspace";
import { Module } from "@nestjs/common";
import { AuthController, UsersController } from "./auth";
import {
  TasksController,
  TimeController,
  LocationsController,
  AssetsController,
  SchedulesController,
  HealthController,
} from "./core";
import { AttachmentsController } from "./attachments";
import { InventoryController } from "./inventory";
import { RecurrenceController, SeasonController } from "./recurrence";
import { ReportingController } from "./reporting";
@Module({
  controllers: [
    ModerationController,
    AccountPrivacyController,
    PublicInfoController,
    IntegrationsController,
    ProductivityController,
    BackupsController,
    OneDriveController,
    SettingsController,
    SetupController,
    MfaController,
    CatalogImportController,
    WorkspaceController,
    AuthController,
    UsersController,
    TasksController,
    TimeController,
    LocationsController,
    AssetsController,
    SchedulesController,
    HealthController,
    AttachmentsController,
    InventoryController,
    RecurrenceController,
    SeasonController,
    ReportingController,
  ],
})
export class AppModule {}
