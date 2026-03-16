/* global OT, apiKey, sessionId, token, userName, roomRole */

import view from "./view.js";

const elPublisherId = "publisher";
const elSubscribersId = "subscribers";
const elPubShareScreenId = "pub-share-screen";
const elSubShareScreenId = "sub-share-screen";
const isAgentRole = roomRole === "agent";
const oneWayCustomerVideoOnly = true;

// Initialize a Vonage Video session object
let session = null;

// Initialize the camera publisher
let publisher = null;

// For this demo we're just assuming one customer
let subscriber = null;
let screenSharePublisher = null;
let screenShareSubscriber = null;
let isSharingScreen = false;

// Initial setup for the page
function setup() {
  // Initialize a Vonage Video session object
  initializeVonageVideo();

  view.hideShareScreen();

  if (isAgentRole) {
    const publisherEl = document.getElementById(elPublisherId);
    if (publisherEl) {
      publisherEl.style.display = "none";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var checkbox = window.parent.document.querySelector(
      'input[type="checkbox"]',
    );
    if (checkbox) {
      checkbox.disabled = oneWayCustomerVideoOnly;
    }
    if (checkbox && !oneWayCustomerVideoOnly) {
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) {
          startShareScreen();
        } else {
          stopShareScreen();
        }
      });
    }
  });
}

function initializeVonageVideo() {
  session = OT.initSession(apiKey, sessionId);
  if (!isAgentRole) {
    publisher = OT.initPublisher(elPublisherId, {
      name: userName,
      height: "100%",
      width: "100%",
      showControls: true,
      publishAudio: !oneWayCustomerVideoOnly,
      publishVideo: true,
      style: {
        nameDisplayMode: "on",
      },
    });
  }
  // Attach event handlers
  session.on({
    // This function runs when session.connect() asynchronously completes
    sessionConnected: function () {
      // Publish the publisher we initialzed earlier (this will trigger 'streamCreated' on other
      // clients)
      if (publisher) {
        session.publish(publisher);
      }
    },

    // This function runs when another client publishes a stream (eg. session.publish())
    streamCreated: function (event) {
      let subOptions = {
        appendMode: "append",
        showControls: true,
        width: "100%",
        height: "100%",
        subscribeToAudio: !(oneWayCustomerVideoOnly && isAgentRole),
        subscribeToVideo: true,
        style: {
          nameDisplayMode: "on",
        },
      };

      // Set subscriber objects to global reference
      if (event.stream.videoType === "screen") {
        // Screen share
        view.addSubShareScreen();
        screenShareSubscriber = session.subscribe(
          event.stream,
          elSubShareScreenId,
          subOptions,
        );
        screenShareSubscriber.on("destroyed", onShareScreenStop);
        view.showShareScreen();
      } else {
        // Subscriber main/camera
        subscriber = session.subscribe(
          event.stream,
          elSubscribersId,
          subOptions,
        );
      }
    },

    streamDestroyed: function (event) {
      if (
        event.reason == "clientDisconnected" &&
        event.stream.videoType == "camera"
      ) {
        window.close();
      }
    },
  });
}

function startShareScreen() {
  if (oneWayCustomerVideoOnly) {
    return;
  }

  OT.checkScreenSharingCapability(function (response) {
    if (!response.supported || response.extensionRegistered === false) {
      // This browser does not support screen sharing.
    } else if (response.extensionInstalled === false) {
      // Prompt to install the extension.
    } else {
      // Screen sharing is available. Publish the screen.
      view.addPubShareScreen();
      view.showShareScreen();

      var publishOptions = {
        name: userName + "'s screen",
        videoSource: "screen",
        width: "100%",
        height: "100%",
        appendMode: "append",
        style: {
          nameDisplayMode: "on",
        },
      };

      screenSharePublisher = OT.initPublisher(
        elPubShareScreenId,
        publishOptions,
        function (error) {
          if (error) {
            console.error(error);
            onShareScreenStop();
          } else {
            session.publish(screenSharePublisher, function (error) {
              isSharingScreen = true;
              if (error) console.error(error);
            });
          }
        },
      );

      screenSharePublisher.on("streamDestroyed", onShareScreenStop);
    }
  });
}

function stopShareScreen() {
  if (isSharingScreen) {
    screenSharePublisher.destroy();
    isSharingScreen = false;
  }
}

/**
 * If subscriber or publisher stops a screen share
 */
function onShareScreenStop(event) {
  setTimeout(() => {
    if (!view.isAnyoneSharing()) view.hideShareScreen();

    // Dirty way of switching the share screen switch off
    let checkbox = window.parent.document.querySelector(
      'input[type="checkbox"]',
    );
    if (checkbox) checkbox.checked = false;
  }, 100);
}

setup();
// Connect to the Session using the 'apiKey' of the application and a 'token' for permission
session.connect(token);
