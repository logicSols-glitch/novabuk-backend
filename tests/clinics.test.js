const request = require("supertest");
const app = require("../server");
const Clinic = require("../models/Clinic");

describe("Clinic Directory System", () => {
  const testClinic = {
    name: "City Health Center",
    email: "cityhealth@test.com",
    password: "clinicpassword123",
    location: {
      address: "123 Main St",
      city: "Lagos",
      state: "Lagos"
    },
    specialty: "General Medicine"
  };

  it("should register a new clinic via admin", async () => {
    // In a real scenario, we'd need an admin token. 
    // For this test, we are checking the public listing functionality.
    const res = await request(app)
      .post("/api/clinics/register")
      .send(testClinic);

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(testClinic.name);
  });

  it("should appear in the clinics list", async () => {
    // Register the clinic first
    await Clinic.create(testClinic);

    const res = await request(app).get("/api/clinics");

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.some(c => c.name === testClinic.name)).toBe(true);
  });
});
