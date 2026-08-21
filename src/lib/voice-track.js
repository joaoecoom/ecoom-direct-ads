/**
 * Voice track continuity — visual segments may change; voice stays consistent.
 */

export function getProjectVoiceProfile(project = {}) {
  return {
    voiceId: project.voice?.voiceId || project.settings?.voiceId || process.env.ELEVENLABS_VOICE_ID || null,
    voiceAssetId: project.voice?.voiceAssetId || project.voiceAssetId || null,
    voiceProfile: project.voice?.voiceProfile || project.settings?.voiceProfile || null,
    voiceContinuityId:
      project.voice?.voiceContinuityId ||
      project.voice?.voiceAssetId ||
      project.voiceAssetId ||
      null,
  };
}

export function attachVoiceToTimelineSegment(segment, voiceProfile) {
  return {
    ...segment,
    voiceId: voiceProfile.voiceId,
    voiceAssetId: voiceProfile.voiceAssetId,
    voiceContinuityId: voiceProfile.voiceContinuityId,
    visualVideoAssetId: segment.videoAssetId || null,
    voiceVideoAssetId: voiceProfile.voiceAssetId,
  };
}

export function mergeVoiceVisualTimeline({ voiceTrackAssetId, visualSegments = [], voiceProfile }) {
  const profile = voiceProfile || { voiceAssetId: voiceTrackAssetId };
  return {
    voiceTrackAssetId: profile.voiceAssetId || voiceTrackAssetId,
    voiceContinuityId: profile.voiceContinuityId || profile.voiceAssetId,
    segments: visualSegments.map((seg) => attachVoiceToTimelineSegment(seg, profile)),
  };
}
