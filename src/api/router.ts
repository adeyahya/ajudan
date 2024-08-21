import docker from '@/lib/docker';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming'

const api = new Hono()
  .use(logger())
  .get('/health', async (c) => c.json({ message: "ok" }))
  .get('/container/:id/logs', async (c) => {
    const container = docker.getContainerById(c.req.param().id ?? '')
    const logStream = await container.logs({
      stderr: true,
      stdout: true,
      follow: true,
      tail: 500,
    })

    return streamSSE(c, async (stream) => {
      let id = 0
      logStream.addListener("data", async data => {
        await stream.writeSSE({
          data: data.toString(),
          event: 'message',
          id: String(id++),
        })
      })
      while (true) {
        await stream.sleep(1000)
      }
    })
  });

const app = api.route('/api', api);

export type AppType = typeof app;
export default app;