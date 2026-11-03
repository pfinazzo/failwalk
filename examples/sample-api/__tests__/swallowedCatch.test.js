const request = require("supertest");
const { app } = require("../app");

describe("DELETE /subscriptions/:id", () => {
  test("reports the subscription archived", async () => {
    const response = await request(app).delete("/subscriptions/sub_1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ archived: true });
  });
});
