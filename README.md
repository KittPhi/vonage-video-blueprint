# Deployment Guide for Vonage Video on Genesys Cloud

> View the original [Vonage Video Blueprint article](https://developer.mypurecloud.com/blueprints/vonage-video-blueprint/) on the Genesys Cloud Developer Center.

This is a modifed Genesys Blueprint that provides instructions for deploying Vonage Video on Genesys Cloud. The Vonage Video API makes it easy to embed high-quality interactive video, voice and messaging into web and mobile apps. For more information on how the platform works, see the [Vonage Video overview](https://developer.vonage.com/en/video/overview).

Genesys Cloud uses **Interaction Widget** to provide customers with a Vonage Video interaction.

![Flowchart](blueprint/images/flowchart.png "Flowchart")

## Dual Use Cases

### Use Case One (UC1) Requirements

- Agent publishes nothing.
- Agent subscribes only to customer video.
- Agent hears no customer audio.
- Neither side publishes audio.
- Agent UI shows only customer video.
- Customer UI shows only own video.
- Agent does not have local publisher tile.
- Customer cannot enable microphone.

### Use Case Two (UC2) Requirements

- Agent publishes audio only (no video).
- Customer publishes audio + video.
- Agent subscribes to customer video.
- Customer subscribes to agent audio only.
- Agent can mute/unmute own's mic.
- Customer can mute/unmute own's mic and has local video.
- Customer hears agent audio.
- Agent view keeps customer video as the primary tile.
- Agent view highlights customer container border when customer speaks.
- Customer view highlights customer container border when customer speaks.
- Customer view highlights agent audio container border when agent speaks.
- Agent UI shows customer video full view with speaking-state border highlights.
- Customer UI shows own video with an embedded agent-audio area and speaking-state border highlights.

## Run Both Use Cases Locally to Demo

### 1. Install and start

```bash
npm install
npm run start-server
```

The app runs on:

- `https://localhost:8080` (or your configured `expressPort`)

If you changed host/port in `config.js`, use your configured `appURI`.

### 2. Pick a conversation ID

Use any valid conversation ID for your test and open agent/customer links with the same ID.

Example:

- `CONVERSATION_ID=71e1d07d-be9b-4a1c-9ef7-8d2c2cdaeb2c`

## Demo URLs by Use Case

Replace `<conversationId>` and `<username>` in the URLs below.

### Use Case 1 (one-way video)

Behavior follows the UC1 requirements listed above.

Open these routes:

- Agent: `https://localhost:8080/room/agent/<conversationId>?username=<username>`
- Customer: `https://localhost:8080/room/customer/<conversationId>?username=<username>`

### Use Case 2 (agent audio + customer audio/video)

Behavior follows the UC2 requirements listed above.

Open these routes:

- Agent: `https://localhost:8080/room/agent/uc2/<conversationId>?username=<username>`
- Customer: `https://localhost:8080/room/customer/uc2/<conversationId>?username=<username>`

## Vonage Video API Implementation

This app integrates Vonage Video with a server-issued token model and a shared session per conversation.

### 1. Server creates/reuses a Vonage session per conversation

The server keeps an in-memory `conversationId -> sessionId` map. If no session exists yet, it creates one via Vonage Video API.

```js
// vonage-server-app.js
let sessions = {};

async function _createSession() {
  const session = await vonage.video.createSession({});
  return session.sessionId;
}

if (!sessions[conversationId]) {
  sessionId = await _createSession();
  sessions[conversationId] = sessionId;
}
```

### 2. Server issues role-based Vonage tokens

The token role enforces who can publish and who can only subscribe. In UC1, the agent gets a `subscriber` token; in UC2, the agent gets a `publisher` token.

```js
// vonage-server-app.js
const tokenRole =
  participantRole === "agent" && useCase === 1 ? "subscriber" : "publisher";

const token = vonage.video.generateClientToken(sessionId, {
  role: tokenRole,
  data: userName,
});
```

### 3. Express routes select the use case and view

The route determines `useCase`, template, and publish flags sent to the browser.

For Use Case 2, both users `publishAudio`.

```js
// web-server.js (UC2 examples)
app.get("/room/agent/uc2/:conversation_id", async (req, res) => {
  vonageApp
    .createRoom(conversation_id, userName, "agent", 2)
    .then((vonageData) => {
      res.render("agent-room-uc2.ejs", {
        vonageData,
        roomRole: "agent",
        publishAudio: true,
        useCase: 2,
        appURI,
      });
    });
});
```

### 4. Browser joins session and applies media policy

The client uses global values rendered by EJS (`apiKey`, `sessionId`, `token`, `roomRole`, `useCase`) and enforces media behavior with helper functions.

These helpers gate local publish behavior by use case and participant role.

```js
// public/js/vonage-room/room.js
function shouldCreateLocalPublisher() {
  if (useCase === 1 && roomRole === "agent") return false;
  return true;
}

function shouldPublishLocalAudio() {
  if (useCase === 1) return false;
  return true;
}

function shouldPublishLocalVideo() {
  if (useCase === 2 && roomRole === "agent") return false;
  return true;
}
```

### 5. Speaking state uses audio-level events + CSS border highlight

Speaking state is detected via the Video API `audioLevelUpdated` event, then reflected by toggling `is-speaking` on local and remote containers.

```js
// public/js/vonage-room/room.js
function markSpeaking(indicatorId) {
  const indicator = document.getElementById(indicatorId);
  if (!indicator) return;
  indicator.classList.add("is-speaking");
  // remove class shortly after signal drops
}

publisher.on("audioLevelUpdated", (event) => {
  if (event.audioLevel > SPEAKING_LEVEL_THRESHOLD) {
    markSpeaking("agent-speaking-indicator");
  }
});
```

## Use Case Mapping With Code

### Use Case 1: Agent subscribes only, Customer video-only

Key controls in code:

```js
// Server token role (agent cannot publish in UC1)
participantRole === "agent" && useCase === 1 ? "subscriber" : "publisher";

// Client media policy
if (useCase === 1 && roomRole === "agent") return false; // no local publisher
if (useCase === 1) return false; // no local audio for anyone

// Subscriber options on agent side
subscribeToAudio: false,
subscribeToVideo: true,
```

Result:

- Agent does not publish.
- Agent sees customer video only.
- Customer publishes video only.

### Use Case 2: Agent audio-only, Customer audio+video

Key controls in code:

```js
// UC2 routes pass useCase=2 to templates
res.render("agent-room-uc2.ejs", { roomRole: "agent", useCase: 2, publishAudio: true, ... });
res.render("customer-room-uc2.ejs", { roomRole: "customer", useCase: 2, publishAudio: true, ... });

// Agent publishes audio-only
if (useCase === 2 && roomRole === "agent") return false; // publishVideo = false

// Customer subscribes to audio-only remote stream
const audioOnly = useCase === 2 && roomRole === "customer";
subscribeToAudio: useCase === 2 ? true : audioOnly,
subscribeToVideo: !audioOnly,
```

Result:

- Agent publishes mic audio (no local video).
- Customer publishes mic + camera.
- Agent receives customer media and sees customer as the main tile.
- Customer receives agent audio.
- UC2 speaking state is shown by border highlight on relevant containers.
