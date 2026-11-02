const request = require("supertest");
const { app } = require("../app");

describe("GET /customers/:id/invoices", () => {
  test("lists the customer's invoices", async () => {
    const response = await request(app).get("/customers/cus_1/invoices");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: "inv_1", amount: 1200 },
      { id: "inv_2", amount: 1200 },
    ]);
  });

  test("returns an empty list for a customer with no invoices", async () => {
    const response = await request(app).get("/customers/cus_nobody/invoices");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
