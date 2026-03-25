/* global OT, apiKey, sessionId, token, roomRole, publishAudio, useCase */

const elPublisherId = "publisher";
const elSubscribersId = "subscribers";
const LAYOUT_STABLE_DELAY_MS = 450;
const LAYOUT_OBSERVER_RETRY_MS = 250;
const LAYOUT_OBSERVER_MAX_RETRIES = 20;
const SPEAKING_LEVEL_THRESHOLD = 0.01;
const SPEAKING_HOLD_MS = 250;

// Initialize a Vonage Video session object
let session = null;

// Initialize the camera publisher
let publisher = null;

// For this demo we're just assuming one customer
let subscriber = null;
let cameraStream = null;
let layoutStableTimer = null;
let layoutObserver = null;
let layoutObserverRetries = 0;
let pendingInitialSubscribe = false;
const speakingTimers = {};

function markSpeaking(indicatorId) {
  const indicator = document.getElementById(indicatorId);
  if (!indicator) return;

  indicator.classList.add("is-speaking");
  if (speakingTimers[indicatorId]) {
    clearTimeout(speakingTimers[indicatorId]);
  }

  speakingTimers[indicatorId] = setTimeout(() => {
    indicator.classList.remove("is-speaking");
  }, SPEAKING_HOLD_MS);
}

function setupSpeakingIndicator() {
  if (!publisher) return;

  // Local speaking should only highlight the local participant tile.
  const indicatorId =
    roomRole === "agent"
      ? "agent-speaking-indicator"
      : "customer-speaking-indicator";
  if (!document.getElementById(indicatorId)) return;

  publisher.on("audioLevelUpdated", (event) => {
    const level =
      event && typeof event.audioLevel === "number" ? event.audioLevel : 0;
    if (level > SPEAKING_LEVEL_THRESHOLD) {
      markSpeaking(indicatorId);
    }
  });
}

function setupRemoteSpeakingIndicator(activeSubscriber) {
  if (!activeSubscriber) return;
  if (useCase !== 2) return;

  let indicatorId = null;
  if (roomRole === "customer") {
    // Customer page indicates when agent (remote) is speaking.
    indicatorId = "remote-speaking-indicator";
  } else if (roomRole === "agent") {
    // Agent page indicates when customer (remote) is speaking.
    indicatorId = "customer-speaking-indicator";
  }
  if (!document.getElementById(indicatorId)) return;

  activeSubscriber.on("audioLevelUpdated", (event) => {
    const level =
      event && typeof event.audioLevel === "number" ? event.audioLevel : 0;
    if (level > SPEAKING_LEVEL_THRESHOLD) {
      markSpeaking(indicatorId);
    }
  });
}

// Initial setup for the page
function setup() {
  // Initialize a Vonage Video session object
  initializeVonageVideo();
  initializeLayoutObserver();

  document.addEventListener("DOMContentLoaded", function () {
    initializeLayoutObserver();
  });
}

function initializeLayoutObserver() {
  if (layoutObserver || typeof ResizeObserver === "undefined") return;

  const target = document.getElementById(elSubscribersId);
  if (!target) {
    if (layoutObserverRetries < LAYOUT_OBSERVER_MAX_RETRIES) {
      layoutObserverRetries += 1;
      setTimeout(initializeLayoutObserver, LAYOUT_OBSERVER_RETRY_MS);
    }
    return;
  }

  layoutObserver = new ResizeObserver(() => {
    scheduleStableLayoutCheck("resizeObserver");
  });

  layoutObserver.observe(target);
  layoutObserverRetries = 0;
}

function shouldCreateLocalPublisher() {
  // UC1 agent: subscriber token only, publishes nothing.
  if (useCase === 1 && roomRole === "agent") return false;
  // UC2 agent: publishes audio only.
  // All customers: always publish (video in UC1, audio+video in UC2).
  return true;
}

function shouldSubscribeToRemoteStreams() {
  // UC1: only agent subscribes (to customer video).
  // UC2: agent subscribes to customer video; customer subscribes to agent audio.
  return roomRole === "agent" || useCase === 2;
}

function shouldPublishLocalAudio() {
  // UC1: nobody publishes audio.
  if (useCase === 1) return false;
  // UC2: both agent and customer publish audio.
  return true;
}

function shouldPublishLocalVideo() {
  // UC2 agent: audio only, no video.
  if (useCase === 2 && roomRole === "agent") return false;
  // All other publishers (customers in both UCs) publish video.
  return true;
}

function initializeVonageVideo() {
  session = OT.initSession(apiKey, sessionId);

  if (shouldCreateLocalPublisher()) {
    publisher = OT.initPublisher(elPublisherId, {
      name: userName,
      height: "100%",
      width: "100%",
      showControls: useCase === 2,
      publishAudio: shouldPublishLocalAudio(),
      publishVideo: shouldPublishLocalVideo(),
      style: {
        nameDisplayMode: "on",
      },
    });

    // UC1 hard guard: customer never publishes audio in use case 1.
    if (useCase === 1 && roomRole === "customer" && publisher) {
      publisher.publishAudio(false);
    }

    setupSpeakingIndicator();
  }

  // Attach event handlers
  session.on({
    // This function runs when session.connect() asynchronously completes
    sessionConnected: function () {
      if (!publisher) return;

      // Publish the publisher we initialzed earlier (this will trigger 'streamCreated' on other
      // clients)
      session.publish(publisher, function (error) {
        // In one-way scenarios, agent may have subscriber-only permissions.
        if (error) {
          console.warn("Publisher not started:", error.message || error);
        }
      });
    },

    // This function runs when another client publishes a stream (eg. session.publish())
    streamCreated: function (event) {
      // Customer-side in this use case is publish-only (no subscribe).
      if (!shouldSubscribeToRemoteStreams()) {
        return;
      }

      // Set subscriber objects to global reference
      if (event.stream.videoType === "screen") {
        // Agent-side in this use case subscribes only to customer camera video.
        return;
      }

      // Subscriber main/camera
      cameraStream = event.stream;
      pendingInitialSubscribe = true;
      scheduleStableLayoutCheck("streamCreated");
    },

    streamDestroyed: function (event) {
      if (
        event.reason == "clientDisconnected" &&
        event.stream.videoType == "camera"
      ) {
        window.close();
      }

      if (cameraStream && event.stream.id === cameraStream.id) {
        cameraStream = null;
        subscriber = null;
        pendingInitialSubscribe = false;
      }
    },
  });
}

function canAttachSubscriber() {
  initializeLayoutObserver();
  const target = document.getElementById(elSubscribersId);
  if (!target) return false;

  // In this layout, #subscribers can be empty (height 0) until OT inserts media.
  // Gate on visible container dimensions instead of target's initial height.
  const targetRect = target.getBoundingClientRect();
  const container = target.closest(".stream-container") || target.parentElement;
  const containerRect = container
    ? container.getBoundingClientRect()
    : { width: 0, height: 0 };

  return (
    containerRect.width > 0 &&
    containerRect.height > 0 &&
    (targetRect.width > 0 || containerRect.width > 0)
  );
}

function isSubscriberHealthy() {
  if (!subscriber || !cameraStream) return false;
  if (!canAttachSubscriber()) return false;

  try {
    return !!subscriber.stream && subscriber.stream.id === cameraStream.id;
  } catch (e) {
    return false;
  }
}

function getSubscriberOptions() {
  // UC2 customer subscribes to agent's audio stream (agent has no video).
  const audioOnly = useCase === 2 && roomRole === "customer";
  return {
    appendMode: "append",
    showControls: false,
    // UC2 agent also subscribes to audio so remote speaking level is available.
    subscribeToAudio: useCase === 2 ? true : audioOnly,
    subscribeToVideo: !audioOnly,
    width: "100%",
    height: "100%",
    style: {
      nameDisplayMode: "on",
    },
  };
}

function subscribeToCamera(subOptions) {
  if (!cameraStream || !session) return;

  if (subscriber) {
    return;
  }

  if (!canAttachSubscriber()) {
    return;
  }

  const createdSubscriber = session.subscribe(
    cameraStream,
    elSubscribersId,
    subOptions,
    function (error) {
      if (!error) return;

      console.error("Camera subscribe failed:", error);
      subscriber = null;
      pendingInitialSubscribe = true;
      scheduleStableLayoutCheck("subscribeError");
    },
  );

  if (createdSubscriber) {
    subscriber = createdSubscriber;
    pendingInitialSubscribe = false;
    setupRemoteSpeakingIndicator(subscriber);
    subscriber.on("destroyed", () => {
      subscriber = null;
      if (cameraStream) {
        scheduleStableLayoutCheck("subscriberDestroyed");
      }
    });
  }
}

function scheduleStableLayoutCheck() {
  if (layoutStableTimer) {
    clearTimeout(layoutStableTimer);
  }

  layoutStableTimer = setTimeout(() => {
    recoverSubscriberAfterLayoutChange();
  }, LAYOUT_STABLE_DELAY_MS);
}

function recoverSubscriberAfterLayoutChange() {
  if (!cameraStream || !session) return;

  // Initial subscribe is delayed until layout settles and a real container exists.
  if (pendingInitialSubscribe) {
    subscribeToCamera(getSubscriberOptions());
    return;
  }

  // Non-destructive resize recovery: only re-subscribe when health check fails.
  if (!isSubscriberHealthy()) {
    subscriber = null;
    subscribeToCamera(getSubscriberOptions());
  }
}

setup();
window.addEventListener("resize", () => {
  scheduleStableLayoutCheck("windowResize");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scheduleStableLayoutCheck("visibilitychange");
  }
});
// Connect to the Session using the 'apiKey' of the application and a 'token' for permission
session.connect(token);
