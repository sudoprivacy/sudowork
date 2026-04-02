from hook.file import FileData, FileInterceptor
from hook.network import NetworkData, Urllib3Interceptor
from hook.nexus import NexusPayload, NexusPayloadType, NexusController
from hook.process import ProcessData, ProcessInterceptor

nexus_controller = NexusController("http://127.0.0.1:12012")


def build_callback(payload_type: NexusPayloadType):
    def callback(data):
        return nexus_controller.control(NexusPayload(type=payload_type, data=data))

    return callback


Urllib3Interceptor(build_callback(NexusPayloadType.NETWORK)).setup()

FileInterceptor(build_callback(NexusPayloadType.FILE)).setup()

ProcessInterceptor(build_callback(NexusPayloadType.PROCESS)).setup()
