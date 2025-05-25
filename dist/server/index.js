import express from "express";
import { createServer } from "http";
import { pgTable, text, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import dotenv from "dotenv";
import { and, gte, lte, eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  service: text("service").notNull(),
  // 'haircut', 'shave', 'combo'
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  name: text("name")
  // optional
});
const insertAppointmentSchema = createInsertSchema(appointments, {
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  service: z.enum(["haircut", "shave", "combo"]),
  startTime: z.coerce.date(),
  endTime: z.coerce.date()
}).omit({ id: true });
const SERVICES = {
  haircut: { name: "Signature Cut", duration: 30, price: 45 },
  shave: { name: "Classic Shave", duration: 30, price: 35 },
  combo: { name: "The Full Experience", duration: 60, price: 65 }
};
const schema = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  SERVICES,
  appointments,
  insertAppointmentSchema
}, Symbol.toStringTag, { value: "Module" }));
dotenv.config();
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });
class DatabaseStorage {
  async getAppointments() {
    return await db.select().from(appointments);
  }
  async getAppointmentsByDate(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return await db.select().from(appointments).where(
      and(
        gte(appointments.startTime, startOfDay),
        lte(appointments.startTime, endOfDay)
      )
    );
  }
  async getAppointment(id) {
    const [appointment] = await db.select().from(appointments).where(eq(appointments.id, id));
    return appointment || void 0;
  }
  async createAppointment(insertAppointment) {
    console.log("Creating appointment:", insertAppointment);
    const [appointment] = await db.insert(appointments).values(insertAppointment).returning();
    console.log("Created appointment:", appointment);
    return appointment;
  }
  async deleteAppointment(id) {
    const result = await db.delete(appointments).where(eq(appointments.id, id));
    return (result.rowCount || 0) > 0;
  }
  async checkTimeSlotAvailable(startTime, endTime) {
    const conflictingAppointments = await db.select().from(appointments).where(
      and(
        // Check for overlapping appointments
        lte(appointments.startTime, endTime),
        gte(appointments.endTime, startTime)
      )
    );
    return conflictingAppointments.length === 0;
  }
}
const storage = new DatabaseStorage();
async function registerRoutes(app2) {
  app2.get("/api/appointments", async (req, res) => {
    try {
      const { date } = req.query;
      if (date && typeof date === "string") {
        const targetDate = new Date(date);
        if (isNaN(targetDate.getTime())) {
          return res.status(400).json({ message: "Invalid date format" });
        }
        const appointments22 = await storage.getAppointmentsByDate(targetDate);
        return res.json(appointments22);
      }
      const appointments2 = await storage.getAppointments();
      res.json(appointments2);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });
  app2.post("/api/appointments", async (req, res) => {
    try {
      const result = insertAppointmentSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: result.error.issues
        });
      }
      const appointmentData = result.data;
      if (!(appointmentData.service in SERVICES)) {
        return res.status(400).json({ message: "Invalid service type" });
      }
      const startHour = appointmentData.startTime.getHours();
      const endHour = appointmentData.endTime.getHours();
      const endMinutes = appointmentData.endTime.getMinutes();
      if (startHour < 9 || startHour >= 19 || endHour > 19 || endHour === 19 && endMinutes > 0) {
        return res.status(400).json({
          message: "Appointments must be between 09:00 and 19:00"
        });
      }
      const isAvailable = await storage.checkTimeSlotAvailable(
        appointmentData.startTime,
        appointmentData.endTime
      );
      if (!isAvailable) {
        return res.status(409).json({
          message: "Time slot is already booked"
        });
      }
      const appointment = await storage.createAppointment(appointmentData);
      res.status(201).json(appointment);
    } catch (error) {
      console.error("Error creating appointment:", error);
      res.status(500).json({ message: "Failed to create appointment" });
    }
  });
  app2.delete("/api/appointments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid appointment ID" });
      }
      const deleted = await storage.deleteAppointment(id);
      if (!deleted) {
        return res.status(404).json({ message: "Appointment not found" });
      }
      res.json({ message: "Appointment cancelled successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to cancel appointment" });
    }
  });
  app2.get("/api/appointments/availability/:date", async (req, res) => {
    try {
      const date = new Date(req.params.date);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      const existingAppointments = await storage.getAppointmentsByDate(date);
      const slots = [];
      for (let hour = 9; hour < 19; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(date);
          slotStart.setHours(hour, minute, 0, 0);
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + 30);
          if (slotEnd.getHours() > 19) {
            break;
          }
          const isBooked = existingAppointments.some(
            (appointment) => slotStart >= appointment.startTime && slotStart < appointment.endTime || slotEnd > appointment.startTime && slotEnd <= appointment.endTime || slotStart <= appointment.startTime && slotEnd >= appointment.endTime
          );
          slots.push({
            time: slotStart.toTimeString().slice(0, 5),
            // HH:MM format
            available: !isBooked
          });
        }
      }
      res.json(slots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch availability" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse;
  const originalJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
      console.log(logLine);
    }
  });
  next();
});
async function startServer() {
  const server = await registerRoutes(app);
  if (process.env.NODE_ENV === "production") {
    const clientDistPath = path.resolve(__dirname, "..", "..", "dist", "client");
    console.log(`Serving static client files from ${clientDistPath}`);
    app.use(express.static(clientDistPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(clientDistPath, "index.html"));
    });
  }
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`Error: ${status} - ${message}`, err.stack);
    res.status(status).json({ message });
  });
  const port = process.env.PORT || (process.env.NODE_ENV === "production" ? 3e3 : 8e3);
  server.listen(port, () => {
    console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${port}`);
    console.log(`__dirname is ${__dirname}`);
  });
  return server;
}
if (process.env.NODE_ENV !== "test" && !process.env.VERCEL_ENV) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
export {
  app as default
};
