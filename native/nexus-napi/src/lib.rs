use napi::bindgen_prelude::*;
use napi_derive::napi;
use nexus_vfs_client::NexusVfsClient;
use std::sync::Arc;
use tokio::sync::Mutex;

#[napi]
pub struct NexusGrpcClient {
    inner: Arc<Mutex<Option<NexusVfsClient>>>,
    endpoint: String,
}

#[napi]
impl NexusGrpcClient {
    /// Create a new gRPC client targeting the given endpoint (e.g. "http://localhost:2028").
    /// Connection is established lazily on first call.
    #[napi(constructor)]
    pub fn new(endpoint: String) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            endpoint,
        }
    }

    /// Ensure the underlying tonic client is connected.
    async fn ensure_connected(&self) -> Result<()> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let client = NexusVfsClient::connect(&self.endpoint)
                .await
                .map_err(|e| Error::from_reason(format!("gRPC connect failed: {e}")))?;
            *guard = Some(client);
        }
        Ok(())
    }

    /// Generic gRPC call: method name + JSON payload string + auth token.
    /// Returns the response as a JSON string.
    #[napi]
    pub async fn call(
        &self,
        method: String,
        payload: String,
        auth_token: String,
    ) -> Result<String> {
        self.ensure_connected().await?;
        let guard = self.inner.lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| Error::from_reason("client not connected"))?;
        let response = client
            .call(&method, &payload, &auth_token)
            .await
            .map_err(|e| Error::from_reason(format!("gRPC call failed: {e}")))?;
        Ok(response)
    }

    /// Read a file from the VFS. Returns raw bytes.
    #[napi]
    pub async fn read(&self, path: String, auth_token: String) -> Result<Buffer> {
        self.ensure_connected().await?;
        let guard = self.inner.lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| Error::from_reason("client not connected"))?;
        let data = client
            .read(&path, &auth_token)
            .await
            .map_err(|e| Error::from_reason(format!("gRPC read failed: {e}")))?;
        Ok(Buffer::from(data))
    }

    /// Write raw bytes to a VFS path.
    #[napi]
    pub async fn write(
        &self,
        path: String,
        content: Buffer,
        auth_token: String,
    ) -> Result<()> {
        self.ensure_connected().await?;
        let guard = self.inner.lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| Error::from_reason("client not connected"))?;
        client
            .write(&path, &content, &auth_token)
            .await
            .map_err(|e| Error::from_reason(format!("gRPC write failed: {e}")))?;
        Ok(())
    }

    /// Ping the nexus gRPC server. Returns the response as a JSON string.
    #[napi]
    pub async fn ping(&self, auth_token: String) -> Result<String> {
        self.call("ping".to_string(), "{}".to_string(), auth_token)
            .await
    }
}
