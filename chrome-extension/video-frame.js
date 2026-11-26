function captureCurrentVideoFrame(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.seeking || !video.videoWidth || !video.videoHeight) {
    return { error: '当前帧还没准备好。请等画面显示后再抓取。' };
  }
  if (video.mediaKeys) {
    return { error: '这个播放器的内容受保护，无法抓取视频帧。' };
  }

  const time = video.currentTime;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const scale = Math.min(1, 3840 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageUrl = canvas.toDataURL('image/png');
      if (imageUrl.startsWith('data:image/png;base64,') && imageUrl.length <= 2_800_000) {
        return { imageUrl, time };
      }
      canvas.width = Math.max(1, Math.round(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.75));
    }
    return { error: '无法生成这张视频帧。请试试浏览器的「将视频帧另存为…」。' };
  } catch {
    return { error: '这个播放器限制了直接抓帧。可以试试浏览器的「将视频帧另存为…」。' };
  }
}
