import { BackupsController } from "./backups";
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
