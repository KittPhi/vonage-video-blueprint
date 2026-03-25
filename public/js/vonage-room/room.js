/* global OT, apiKey, sessionId, token, roomRole, publishAudio */

const elPublisherId = "publisher";
const elSubscribersId = "subscribers";
const LAYOUT_STABLE_DELAY_MS = 450;
const LAYOUT_OBSERVER_RETRY_MS = 250;
const LAYOUT_OBSERVER_MAX_RETRIES = 20;

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
  return roomRole !== "agent";
}

function shouldSubscribeToRemoteStreams() {
  return roomRole === "agent";
}

function shouldPublishLocalAudio() {
  // Requirement: customer must be video-only.
  if (roomRole === "customer") return false;
  return typeof publishAudio === "boolean" ? publishAudio : false;
}

function initializeVonageVideo() {
  session = OT.initSession(apiKey, sessionId);

  if (shouldCreateLocalPublisher()) {
    publisher = OT.initPublisher(elPublisherId, {
      name: userName,
      height: "100%",
      width: "100%",
      showControls: roomRole !== "customer",
      publishAudio: shouldPublishLocalAudio(),
      style: {
        nameDisplayMode: "on",
      },
    });

    // Hard guard in case upstream flags drift: customer never publishes audio.
    if (roomRole === "customer" && publisher) {
      publisher.publishAudio(false);
    }
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
  return {
    appendMode: "append",
    showControls: false,
    subscribeToAudio: false,
    subscribeToVideo: true,
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
