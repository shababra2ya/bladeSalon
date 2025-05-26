import {
  appointments,
  type Appointment,
  type InsertAppointment,
} from "../shared/schema.js";
import { db } from "./db.js";
import { eq, and, gte, lte, gt, lt } from "drizzle-orm";

export interface IStorage {
  getAppointments(): Promise<Appointment[]>;
  getAppointmentsByDate(date: Date): Promise<Appointment[]>;
  getAppointment(id: number): Promise<Appointment | undefined>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  deleteAppointment(id: number): Promise<boolean>;
  checkTimeSlotAvailable(startTime: Date, endTime: Date): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getAppointments(): Promise<Appointment[]> {
    return await db.select().from(appointments);
  }

  async getAppointmentsByDate(date: Date): Promise<Appointment[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db
      .select()
      .from(appointments)
      .where(
        and(
          gte(appointments.startTime, startOfDay),
          lte(appointments.startTime, endOfDay)
        )
      );
  }

  async getAppointment(id: number): Promise<Appointment | undefined> {
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id));
    return appointment || undefined;
  }
  async createAppointment(
    insertAppointment: InsertAppointment
  ): Promise<Appointment> {
    console.log("Creating appointment:", insertAppointment);
    const [appointment] = await db
      .insert(appointments)
      .values(insertAppointment)
      .returning();
    console.log("Created appointment:", appointment);
    return appointment;
  }

  async deleteAppointment(id: number): Promise<boolean> {
    const result = await db.delete(appointments).where(eq(appointments.id, id));
    return (result.rowCount || 0) > 0;
  }

  async checkTimeSlotAvailable(
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    const conflictingAppointments = await db
      .select()
      .from(appointments)
      .where(
        and(
          // Check for overlapping appointments
          // An overlap occurs when:
          // - existing appointment starts before new appointment ends, AND
          // - existing appointment ends after new appointment starts
          // Use < instead of <= to allow adjacent appointments
          lt(appointments.startTime, endTime),
          gt(appointments.endTime, startTime)
        )
      );

    console.log("Checking time slot availability:", {
      startTime,
      endTime,
      conflictingAppointments,
    });

    return conflictingAppointments.length === 0;
  }
}

export const storage = new DatabaseStorage();
