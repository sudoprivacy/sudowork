import { FileInterceptor } from './file/FileInterceptor';
import { NexusController } from './nexus/NexusController';
import { FileController, type FileFlag } from './file/FileController';
import { BatchInterceptor, type RequestController } from '@mswjs/interceptors';
import NodeInterceptors from '@mswjs/interceptors/presets/node';

const nexusController = new NexusController('http://127.0.0.1:12012', undefined, 600_000);

const network_interceptor = new BatchInterceptor({ name: 'claw-interceptor', interceptors: NodeInterceptors });
network_interceptor.apply();
network_interceptor.on('request', async ({ request, requestId, controller }: { request: Request; requestId: string; controller: RequestController }) => {
  const req = request.clone();
  const body = await req.text();
  await nexusController.control(controller, {
    type: 'network',
    data: {
      requestId: requestId,
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      body: body,
    },
  });
});

const interceptor = new FileInterceptor();
interceptor.apply();
interceptor.on('file', async ({ path, flags, controller }: { path: string; flags: FileFlag[]; controller: FileController }) => {
  await nexusController.control(controller, { type: 'file', data: { path, flags } });
});
