// apps/api/src/admin/admin-drivers-create.controller.ts
// POST /admin/drivers — registers a new driver with phone + password.
// Tenancy comes from JWT via CurrentOperator (defense against IDOR).
import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { DriverNameSchema, type OperatorContext } from "@fleet/domain";
import { CurrentOperator } from "../auth/current-operator.decorator.js";
import { JwtGuard } from "../auth/jwt.guard.js";
import { AdminDriversCreateService } from "./admin-drivers-create.service.js";

const CreateSchema = z.object({
  fullName: DriverNameSchema,
  phone: z.string().min(8).max(32),
  password: z.string().min(6).max(128),
});

export interface CreateDriverResponse {
  readonly driverId: string;
  readonly operatorId: string;
}

@UseGuards(JwtGuard)
@Controller("admin/drivers")
export class AdminDriversCreateController {
  constructor(private readonly service: AdminDriversCreateService) {}

  @Post()
  async create(
    @CurrentOperator() op: OperatorContext,
    @Body() body: z.infer<typeof CreateSchema>,
  ): Promise<CreateDriverResponse> {
    const parsed = CreateSchema.parse(body);
    const row = await this.service.create({
      fullName: parsed.fullName,
      phone: parsed.phone,
      password: parsed.password,
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
    });
    if (row.operatorId === null) {
      throw new Error("AdminDriversCreateService returned driver without operatorId");
    }
    return { driverId: row.driverId, operatorId: row.operatorId };
  }
}
