const request = require("supertest");
const app = require("../server");
const mongoose = require("mongoose");
const User = require("../models/User");

describe("Authentication System", () => {
  const testUser = {
    fullName: "Test Patient",
    email: "test@novabuk.com",
    password: "password123",
    role: "Patient"
  };

  it("should register a new patient", async () => {
    const res = await request(app)
      .post("/api/users/register")
      .send(testUser);

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toHaveProperty("email", testUser.email);
    
    // Verify database entry
    const userInDb = await User.findOne({ email: testUser.email });
    expect(userInDb).toBeTruthy();
    expect(userInDb.fullName).toBe(testUser.fullName);
  });

  it("should login a registered patient", async () => {
    // First, register the user
    await request(app).post("/api/users/register").send(testUser);

    // Then, attempt login
    const res = await request(app)
      .post("/api/users/login")
      .send({
        email: testUser.email,
        password: testUser.password
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("token");
  });

  it("should fail login with incorrect password", async () => {
    await request(app).post("/api/users/register").send(testUser);

    const res = await request(app)
      .post("/api/users/login")
      .send({
        email: testUser.email,
        password: "wrongpassword"
      });

    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });
});
