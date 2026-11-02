/** A fake queue wrapper for the inventory's import tests. */
export default {
  jobs: {
    enqueue: async ({ name }) => ({ name, queued: true }),
  },
};
