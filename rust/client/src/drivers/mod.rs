pub mod ws;
pub mod sse;

#[derive(Debug, Clone, Copy)]
pub enum TransportKind {
    WebSocket,//(ws::WebSocketDriver),
    Sse,//(sse::SseDriver)
}



// impl TransportKind {
//     pub fn new(kind: TransportKind, endpoint: String, encoding_kind: EncodingKind) -> Result<TransportKind> {
//         match kind {
//             Self::WebSocket(_) => {
//                 Ok(TransportKind::WebSocket(ws::WebSocketDriver::new(endpoint, encoding_kind)?))
//             }
//             Self::Sse(_) => {
//                 Ok(TransportKind::Sse(sse::SseDriver::new(endpoint, encoding_kind)?))
//             }
//         }
//     }


// }