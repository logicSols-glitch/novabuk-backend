const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

// Before all tests, start the memory server
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  
  // Close any existing connections before connecting to memory server
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
});

// After all tests, stop the server and disconnect
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Before each test, clear the database
beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }
});

// Global Mocks (e.g. for Email Service)
jest.mock("../services/emailService", () => ({
  sendOTPEmail: jest.fn().mockResolvedValue({ success: true }),
  sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
  sendDoctorWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("../services/paymentService", () => ({
  verifyPayment: jest.fn().mockResolvedValue({ success: true }),
}));
