use napi::bindgen_prelude::*;
use napi_derive::napi;
use nexus_vfs_client::NexusVfsClient;

/// The underlying NexusVfsClient is already thread-safe (sync wrapper
/// around a background tokio thread). All public methods here are
/// synchronous and use napi `AsyncTask` wrappers to avoid blocking the
/// Node.js event loop.

#[napi]
pub struct NexusGrpcClient {
    inner: NexusVfsClient,
}

#[napi]
impl NexusGrpcClient {
    /// Create a new gRPC client targeting the given endpoint
    /// (e.g. "http://localhost:12022").
    /// The TCP connection is lazy — established on first RPC call.
    #[napi(constructor)]
    pub fn new(endpoint: String) -> Result<Self> {
        let inner = NexusVfsClient::connect(&endpoint)
            .map_err(|e| Error::from_reason(format!("gRPC connect failed: {e}")))?;
        Ok(Self { inner })
    }

    /// Generic gRPC call: method name + JSON payload string + auth token.
    /// Returns the response as a JSON string.
    #[napi]
    pub fn call(
        &self,
        method: String,
        payload: String,
        auth_token: String,
    ) -> Result<String> {
        let response = self
            .inner
            .call(&method, payload.as_bytes(), &auth_token)
            .map_err(|e| Error::from_reason(format!("gRPC call failed: {e}")))?;
        String::from_utf8(response)
            .map_err(|e| Error::from_reason(format!("response not UTF-8: {e}")))
    }

    /// Binary gRPC call: method name + raw protobuf payload + auth token.
    /// Returns raw response bytes (protobuf-encoded).
    /// Use this for plugin dispatch (e.g. vault secrets) where the wire
    /// format is protobuf, not JSON.
    #[napi]
    pub fn call_binary(
        &self,
        method: String,
        payload: Buffer,
        auth_token: String,
    ) -> Result<Buffer> {
        let response = self
            .inner
            .call(&method, &payload, &auth_token)
            .map_err(|e| Error::from_reason(format!("gRPC call failed: {e}")))?;
        Ok(Buffer::from(response))
    }

    /// Read a file from the VFS. Returns raw bytes.
    #[napi]
    pub fn read(&self, path: String, auth_token: String) -> Result<Buffer> {
        let data = self
            .inner
            .read(&path, &auth_token)
            .map_err(|e| Error::from_reason(format!("gRPC read failed: {e}")))?;
        Ok(Buffer::from(data))
    }

    /// Write raw bytes to a VFS path.
    #[napi]
    pub fn write(
        &self,
        path: String,
        content: Buffer,
        auth_token: String,
    ) -> Result<()> {
        self.inner
            .write(&path, content.to_vec(), &auth_token)
            .map_err(|e| Error::from_reason(format!("gRPC write failed: {e}")))
    }

    /// Ping the nexus gRPC server. Returns the response as a JSON string.
    #[napi]
    pub fn ping(&self, auth_token: String) -> Result<String> {
        self.call("ping".to_string(), "{}".to_string(), auth_token)
    }
}
