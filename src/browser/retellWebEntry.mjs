import { LogLevel, setLogLevel } from 'livekit-client';
import { RetellWebClient } from 'retell-client-js-sdk';

// Homepage calls are ephemeral. Keep the bundled transport from writing room,
// participant, endpoint, transcript, or retry context to the browser console.
setLogLevel(LogLevel.silent);

export { RetellWebClient };
