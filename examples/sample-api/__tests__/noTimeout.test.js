const request = require("supertest");
const { app } = require("../app");

describe("POST /welcome", () => {
  test("queues the welcome email and answers 202", async () => {
    const response = await request(app).post("/welcome").send({ email: "new@example.test" });
    expect(response.status).toBe(202);
    expect(response.body.to).toBe("new@example.test");
  });
});
