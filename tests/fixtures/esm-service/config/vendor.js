/** A fake vendor wrapper for the inventory's import tests. */
export const accounts = {
  get: async ({ accountId }) => ({ id: accountId }),
  close: async ({ accountId }) => ({ id: accountId, closed: true }),
};
export const ping = async () => "pong";
