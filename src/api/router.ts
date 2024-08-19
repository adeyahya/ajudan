import docker from '@/lib/docker';
import { Hono, type Context } from 'hono';
import { logger } from 'hono/logger';
import { streamText } from 'hono/streaming'

const api = new Hono()
  .use(logger())
  .get('/health', async (c) => c.json({ message: "ok" }))
  .get('/container/:id/logs', async (c) => {
    const container = docker.getContainerById(c.req.param().id ?? '')
    const readableStream = await container.logs({
      stderr: true,
      stdout: true,
      follow: true
    })

    return streamText(c, async (stream) => {
      readableStream.on("data", async (buffer) => {
        if (buffer instanceof Buffer) {
          await stream.write(buffer.toString())
        }
      })

      // TODO: proper stream
      await stream.sleep(60000 * 5)
    })
  })

const app = api.route('/api', api);

export type AppType = typeof app;
export default app;