import {
  animationSelector,
  sceneSelector,
  setRecordingFlag,
} from "./events.js";
import { animationStates } from "./spine-loader.js";
import { currentModel } from "./live2d-loader.js"; // Added import

// ref. https://github.com/Nikke-db/nikke-db-vue/blob/main/src/components/common/Spine/Loader.vue
const RECORDING_MIME_TYPE = "video/webm;codecs=vp8";
const RECORDING_BITRATE = 12000000;
const RECORDING_FRAME_RATE = 60;
const RECORDING_TIME_SLICE = 10;
const ANIMATION_TIME_EPSILON = 0.02;

let recordingStartTime; // For Live2D timing
let live2dAnimationDuration; // For Live2D timing

export function startRecording(modelType, animationName) { // Modified signature
  const chunks = [];
  let canvas;
  let rec; // Declare rec here to be accessible in checkCondition's scope setup

  if (modelType === "spine") {
    canvas = document.getElementById("spineCanvas");
  } else if (modelType === "live2d") {
    canvas = document.getElementById("live2dCanvas");
    if (!currentModel) {
      console.error("Live2D model not loaded. Cannot start recording.");
      setRecordingFlag(false);
      return;
    }
    const motionManager = currentModel.internalModel.motionManager;
    const parts = animationName.split(',');
    const motionGroup = parts[0]; // Renamed for clarity
    const motionIndex = parseInt(parts[1], 10); // Renamed for clarity

    live2dAnimationDuration = undefined; // Reset before trying to get it

    try {
      // Priority 1: Try to get duration from runtime motion objects if available
      const activeMotion = motionManager.motionGroups[motionGroup]?.[motionIndex];
      if (activeMotion && typeof activeMotion.getDuration === 'function') {
        live2dAnimationDuration = activeMotion.getDuration();
      } else if (activeMotion && typeof activeMotion._motion === 'object' && typeof activeMotion._motion.getDuration === 'function') {
        live2dAnimationDuration = activeMotion._motion.getDuration();
      } else if (activeMotion && typeof activeMotion.duration === 'number') { // Direct duration property
        live2dAnimationDuration = activeMotion.duration;
      }

      // Priority 2: Check internal motions array (another common pattern)
      if (live2dAnimationDuration === undefined) {
        const internalMotion = currentModel.internalModel?.motionManager?.motions?.[motionGroup]?.[motionIndex];
        if (internalMotion && typeof internalMotion.getDuration === 'function') {
          live2dAnimationDuration = internalMotion.getDuration();
        } else if (internalMotion && typeof internalMotion._motion === 'object' && typeof internalMotion._motion.getDuration === 'function') {
          live2dAnimationDuration = internalMotion._motion.getDuration();
        }
      }

      // Priority 3: Cubism 4.x specific way (using _motions.get(index) and _motionJson.Meta.Duration)
      if (live2dAnimationDuration === undefined && currentModel.internalModel?.motionManager?._motions?.get && typeof currentModel.internalModel.motionManager._motions.get === 'function') {
        const cubism4motion = currentModel.internalModel.motionManager._motions.get(motionIndex);
        if (cubism4motion && typeof cubism4motion.getDuration === 'function') {
          live2dAnimationDuration = cubism4motion.getDuration();
        } else if (cubism4motion && typeof cubism4motion._motionJson?.Meta?.Duration === 'number') {
          live2dAnimationDuration = cubism4motion._motionJson.Meta.Duration;
        }
      }

      // Priority 4: Inspect motionManager.definitions (as per new requirement)
      if (live2dAnimationDuration === undefined && motionManager.definitions) {
        const groupDefinitions = motionManager.definitions[motionGroup];
        if (groupDefinitions && groupDefinitions[motionIndex]) {
          const motionDef = groupDefinitions[motionIndex];
          // Try common properties for duration in definition files
          if (typeof motionDef.Duration === 'number') {
            live2dAnimationDuration = motionDef.Duration;
          } else if (motionDef.Meta && typeof motionDef.Meta.Duration === 'number') {
            live2dAnimationDuration = motionDef.Meta.Duration;
          } else if (motionDef.FileInformation && typeof motionDef.FileInformation.Duration === 'number') {
            live2dAnimationDuration = motionDef.FileInformation.Duration;
          } else if (typeof motionDef.duration === 'number') { // lowercase 'duration'
            live2dAnimationDuration = motionDef.duration;
          }
          // If duration is still not found, one could log the motionDef structure here to help identify the correct property
          // console.log("Inspecting Live2D motion definition:", motionDef);
          if (live2dAnimationDuration !== undefined) {
            console.log(`Duration ${live2dAnimationDuration}s found in motion definitions for ${animationName}`);
          } else {
            console.warn(`Motion definition for ${animationName} found, but no known duration property (Duration, Meta.Duration, FileInformation.Duration, duration) was present.`);
          }
        } else {
          console.warn(`Motion definitions for group "${motionGroup}" or index ${motionIndex} not found for ${animationName}.`);
        }
      }

      // Fallback if no duration could be determined
      if (live2dAnimationDuration === undefined) {
        console.warn(`Could not determine duration for Live2D animation: ${animationName} after all attempts. Using a default of 5 seconds.`);
        live2dAnimationDuration = 5; // Default fallback duration
      }
    } catch (error) {
      console.error(`Error getting Live2D animation duration for ${animationName}:`, error);
      live2dAnimationDuration = 5; // Default fallback duration in case of error
    }
    recordingStartTime = performance.now();
  } else {
    console.error("Unknown model type for recording:", modelType);
    setRecordingFlag(false);
    return;
  }

  if (!canvas) {
    console.error(`Canvas not found for modelType: ${modelType}`);
    setRecordingFlag(false);
    return;
  }

  const stream = canvas.captureStream(RECORDING_FRAME_RATE);
  rec = new MediaRecorder(stream, { // Assign to rec declared above
    mimeType: RECORDING_MIME_TYPE,
    videoBitsPerSecond: RECORDING_BITRATE,
  });

  rec.start(RECORDING_TIME_SLICE);

  rec.ondataavailable = (e) => {
    chunks.push(e.data);
  };

  rec.onstart = () => {
    requestAnimationFrame(() => checkCondition(modelType, rec)); // Pass modelType and rec
  };

  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const selectedSceneText =
      sceneSelector.options[sceneSelector.selectedIndex].textContent;
    // Use animationName parameter for the filename, replace comma for safety
    link.download = `${selectedSceneText}_${animationName.replace(',', '-')}.webm`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setRecordingFlag(false);
  };
}

// Modified signature for checkCondition
function checkCondition(modelType, rec) {
  if (modelType === "spine") {
    if (
      animationStates[0] && // Safety check for animationStates[0]
      animationStates[0].tracks &&
      animationStates[0].tracks[0] &&
      animationStates[0].tracks[0].animationLast !== -1 &&
      animationStates[0].tracks[0].animationLast + ANIMATION_TIME_EPSILON >= // Use >=
      animationStates[0].tracks[0].animationEnd
    ) {
      rec.stop();
    } else {
      requestAnimationFrame(() => checkCondition(modelType, rec)); // Pass modelType and rec
    }
  } else if (modelType === "live2d") {
    if (typeof live2dAnimationDuration === 'undefined') {
        console.warn("Live2D animation duration is undefined in checkCondition. Stopping recording based on default of 5s from start.");
        //This case should ideally not be hit if startRecording sets a fallback
        live2dAnimationDuration = (performance.now() - recordingStartTime)/1000 + 5; // Failsafe: record 5 more sec
    }
    const elapsedTime = (performance.now() - recordingStartTime) / 1000; // Convert to seconds
    if (elapsedTime >= live2dAnimationDuration - ANIMATION_TIME_EPSILON) {
      rec.stop();
    } else {
      requestAnimationFrame(() => checkCondition(modelType, rec)); // Pass modelType and rec
    }
  }
}
