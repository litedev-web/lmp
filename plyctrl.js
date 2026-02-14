/*
Player Controller for Lite Music Player
Lite Music Player version: 3.0
Player Controller version: 3.0
Copyright (c) 2026 the Lite developers. All rights reserved.
*/

class PlayerController {
    constructor(fileManager) {
        if (!fileManager) {
            throw new Error('FileManager instance is required');
        }
        
        this.fileManager = fileManager;
        this.audioElement = null;
        this.isPlaying = false;
        this.currentFileId = null;
        this.currentTime = 0;
        this.volume = 1.0;
        this.playbackRate = 1.0;
        this.isMuted = false;
        this.isLoading = false;
        
        this.PlayMode = {
            SEQUENTIAL: 'sequential',
            LIST_LOOP: 'list_loop',
            SINGLE_LOOP: 'single_loop',
            SHUFFLE: 'shuffle'
        };
        
        this.currentMode = this.PlayMode.SEQUENTIAL;
        this.shuffleHistory = [];
        this.shuffleRemaining = [];
        this.silenceSkipperEnabled = false;
        this.skipEndedHandler = null;
        
        this.onPlay = null;
        this.onPause = null;
        this.onSongChange = null;
        this.onTimeUpdate = null;
        this.onEnded = null;
        this.onError = null;
        this.onVolumeChange = null;
        this.onPlaybackRateChange = null;
        this.onModeChange = null;
        this.onLoadStart = null;
        this.onLoadedData = null;
        
        this.hasMediaSession = ('mediaSession' in navigator);
        this.log = this.createLogger();
        this.eventListeners = new Map();
        
        this.initializeAudioElement();
        this.setupMediaSession();
    }

    createLogger() {
        const PREFIX = '[PlayerController]';
        return {
            info: (msg, data) => console.log(`${PREFIX} ${msg}`, data || ''),
            error: (msg, err) => console.error(`${PREFIX} ${msg}`, err || ''),
            warn: (msg, data) => console.warn(`${PREFIX} ${msg}`, data || ''),
            debug: (msg, data) => console.debug(`${PREFIX} ${msg}`, data || '')
        };
    }

    initializeAudioElement() {
        this.audioElement = new Audio();
        this.audioElement.preload = 'metadata';
        
        this.setupAudioEventListeners();
        this.skipEndedHandler = this.handleTrackEnded.bind(this);
        this.audioElement.addEventListener('ended', this.skipEndedHandler);
        
        this.log.info('Audio element initialized');
    }

    setupAudioEventListeners() {
        const events = [
            ['play', this.handlePlay.bind(this)],
            ['pause', this.handlePause.bind(this)],
            ['timeupdate', this.handleTimeUpdate.bind(this)],
            ['error', this.handleError.bind(this)],
            ['volumechange', this.handleVolumeChange.bind(this)],
            ['ratechange', this.handleRateChange.bind(this)],
            ['loadstart', this.handleLoadStart.bind(this)],
            ['loadeddata', this.handleLoadedData.bind(this)],
            ['waiting', this.handleWaiting.bind(this)],
            ['canplay', this.handleCanPlay.bind(this)],
            ['ended', this.handleEnded.bind(this)]
        ];

        events.forEach(([event, handler]) => {
            const boundHandler = handler.bind(this);
            this.eventListeners.set(event, boundHandler);
            this.audioElement.addEventListener(event, boundHandler);
        });

        this.log.debug('Audio event listeners setup completed');
    }

    removeAudioEventListeners() {
        this.eventListeners.forEach((handler, event) => {
            this.audioElement.removeEventListener(event, handler);
        });
        this.eventListeners.clear();
        this.log.debug('Audio event listeners removed');
    }

    handlePlay() {
        this.isPlaying = true;
        this.updateMediaSessionPlaybackState('playing');
        this.log.debug('Play event');
        if (this.onPlay) {
            this.onPlay();
        }
    }

    handlePause() {
        this.isPlaying = false;
        this.updateMediaSessionPlaybackState('paused');
        this.log.debug('Pause event');
        if (this.onPause) {
            this.onPause();
        }
    }

    handleTimeUpdate() {
        this.currentTime = this.audioElement.currentTime;
        
        if (this.hasMediaSession && !isNaN(this.audioElement.duration)) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: this.audioElement.duration,
                    playbackRate: this.audioElement.playbackRate,
                    position: this.currentTime
                });
            } catch (error) {
                this.log.debug('Failed to update media session position state', error);
            }
        }
        
        if (this.onTimeUpdate) {
            this.onTimeUpdate(this.currentTime, this.audioElement.duration);
        }
    }

    handleEnded() {
        this.log.debug('Ended event triggered');
        if (!this.silenceSkipperEnabled) {
            this.handleTrackEnded();
        }
    }

    handleError(e) {
        this.log.error('Audio playback error', e);
        if (this.onError) {
            this.onError(e);
        }
    }

    handleVolumeChange() {
        this.volume = this.audioElement.volume;
        this.isMuted = this.audioElement.muted;
        this.log.debug('Volume changed', { volume: this.volume, muted: this.isMuted });
        if (this.onVolumeChange) {
            this.onVolumeChange(this.volume, this.isMuted);
        }
    }

    handleRateChange() {
        this.playbackRate = this.audioElement.playbackRate;
        this.log.debug('Playback rate changed', { rate: this.playbackRate });
        if (this.onPlaybackRateChange) {
            this.onPlaybackRateChange(this.playbackRate);
        }
    }

    handleLoadStart() {
        this.isLoading = true;
        this.log.debug('Load start');
        if (this.onLoadStart) {
            this.onLoadStart();
        }
    }

    handleLoadedData() {
        this.isLoading = false;
        this.log.debug('Loaded data');
        if (this.onLoadedData) {
            this.onLoadedData();
        }
    }

    handleWaiting() {
        this.log.debug('Waiting for data');
    }

    handleCanPlay() {
        this.log.debug('Can play');
    }

    setupMediaSession() {
        if (!this.hasMediaSession) {
            this.log.info('MediaSession API not supported');
            return;
        }

        try {
            const actions = [
                ['play', () => this.play().catch(error => this.log.error('MediaSession play failed', error))],
                ['pause', () => this.pause()],
                ['previoustrack', () => this.previous().catch(error => this.log.error('MediaSession previous failed', error))],
                ['nexttrack', () => this.next().catch(error => this.log.error('MediaSession next failed', error))],
                ['seekbackward', (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.seek(Math.max(0, this.currentTime - skipTime));
                }],
                ['seekforward', (details) => {
                    const skipTime = details.seekOffset || 10;
                    const duration = this.audioElement.duration || 0;
                    this.seek(Math.min(duration, this.currentTime + skipTime));
                }],
                ['seekto', (details) => {
                    if (details.fastSeek && 'fastSeek' in this.audioElement) {
                        this.audioElement.fastSeek(details.seekTime);
                        return;
                    }
                    this.seek(details.seekTime);
                }]
            ];

            actions.forEach(([action, handler]) => {
                try {
                    navigator.mediaSession.setActionHandler(action, handler);
                } catch (error) {
                    this.log.debug(`MediaSession action ${action} not supported`, error);
                }
            });

            this.updateMediaSessionPlaybackState('none');
            this.log.info('MediaSession setup completed');

        } catch (error) {
            this.log.warn('MediaSession API setup failed', error);
        }
    }

    updateMediaSessionMetadata(file) {
        if (!this.hasMediaSession || !file) {
            return;
        }

        try {
            const metadata = file.metadata;
            let artwork = [];
            
            if (metadata.picture) {
                let mimeType = 'image/jpeg';
                if (metadata.pictureFormat) {
                    if (metadata.pictureFormat.includes('png')) mimeType = 'image/png';
                    else if (metadata.pictureFormat.includes('gif')) mimeType = 'image/gif';
                    else if (metadata.pictureFormat.includes('bmp')) mimeType = 'image/bmp';
                }
                
                artwork.push({
                    src: metadata.picture,
                    sizes: '512x512',
                    type: mimeType
                });
            }

            navigator.mediaSession.metadata = new MediaMetadata({
                title: metadata.title || file.fileName,
                artist: metadata.artist || 'Unknown Artist',
                album: metadata.album || 'Unknown Album',
                artwork: artwork
            });

            this.log.debug('MediaSession metadata updated', { 
                title: metadata.title || file.fileName,
                hasArtwork: artwork.length > 0 
            });

        } catch (error) {
            this.log.warn('Failed to update MediaSession metadata', error);
        }
    }

    updateMediaSessionPlaybackState(state) {
        if (!this.hasMediaSession) {
            return;
        }

        try {
            navigator.mediaSession.playbackState = state;
            this.log.debug('MediaSession playback state updated', { state });
        } catch (error) {
            this.log.debug('Failed to update MediaSession playback state', error);
        }
    }

    async playFile(fileId) {
        this.log.info('Playing file', { fileId });
        
        if (this.currentFileId === fileId && this.audioElement.src) {
            try {
                await this.audioElement.play();
                this.updateMediaSessionPlaybackState('playing');
                return;
            } catch (error) {
                this.log.error('Failed to resume playing current file', error);
                throw error;
            }
        }
        
        const file = this.fileManager.getFileById(fileId);
        if (!file) {
            const error = new Error(`File with ID ${fileId} not found`);
            this.log.error('File not found', error);
            throw error;
        }
        
        this.isLoading = true;
        
        if (this.audioElement.src) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement.load();
        }
        
        this.currentFileId = fileId;
        this.audioElement.src = file.url;
        this.audioElement.load();
        
        this.updateMediaSessionMetadata(file);
        
        if (this.onSongChange) {
            this.onSongChange(file);
        }
        
        try {
            await this.audioElement.play();
            this.updateMediaSessionPlaybackState('playing');
            this.log.info('File playback started', { fileId, title: file.metadata.title || file.fileName });
        } catch (error) {
            this.log.error('Playback failed', error);
            this.updateMediaSessionPlaybackState('paused');
            throw error;
        }
    }

    async playFileByIndex(index) {
        const file = this.fileManager.getFileByIndex(index);
        if (file) {
            await this.playFile(file.id);
        } else {
            const error = new Error(`No file at index ${index}`);
            this.log.error('File not found by index', error);
            throw error;
        }
    }

    async togglePlayPause() {
        if (!this.currentFileId) {
            const playlist = this.fileManager.getPlaylist();
            if (playlist.length > 0) {
                this.log.debug('No current file, playing first in playlist');
                return this.playFile(playlist[0].id);
            }
            this.log.warn('Cannot toggle play/pause, playlist is empty');
            return;
        }
        
        if (this.isPlaying) {
            this.log.debug('Pausing playback');
            this.audioElement.pause();
            this.updateMediaSessionPlaybackState('paused');
        } else {
            try {
                this.log.debug('Resuming playback');
                await this.audioElement.play();
                this.updateMediaSessionPlaybackState('playing');
            } catch (error) {
                this.log.error('Playback failed', error);
                throw error;
            }
        }
    }

    async play() {
        if (!this.currentFileId) {
            return this.togglePlayPause();
        }
        
        try {
            this.log.debug('Explicit play requested');
            await this.audioElement.play();
            this.updateMediaSessionPlaybackState('playing');
        } catch (error) {
            this.log.error('Play failed', error);
            throw error;
        }
    }

    pause() {
        this.log.debug('Pause requested');
        this.audioElement.pause();
        this.updateMediaSessionPlaybackState('paused');
    }

    async next() {
        const playlist = this.fileManager.getPlaylist();
        if (playlist.length === 0) {
            this.log.warn('Cannot play next, playlist is empty');
            return;
        }
        
        const currentIndex = playlist.findIndex(file => file.id === this.currentFileId);
        this.log.debug('Playing next', { currentIndex, playlistLength: playlist.length });
        
        if (this.currentMode === this.PlayMode.SHUFFLE) {
            return this.playNextShuffle();
        }
        
        let nextIndex;
        
        if (currentIndex === -1) {
            nextIndex = 0;
        } else if (currentIndex < playlist.length - 1) {
            nextIndex = currentIndex + 1;
        } else {
            if (this.currentMode === this.PlayMode.LIST_LOOP) {
                nextIndex = 0;
            } else {
                this.pause();
                this.currentFileId = null;
                if (this.onSongChange) {
                    this.onSongChange(null);
                }
                return;
            }
        }
        
        await this.playFile(playlist[nextIndex].id);
    }

    async previous() {
        const playlist = this.fileManager.getPlaylist();
        if (playlist.length === 0) {
            this.log.warn('Cannot play previous, playlist is empty');
            return;
        }
        
        const currentIndex = playlist.findIndex(file => file.id === this.currentFileId);
        this.log.debug('Playing previous', { currentIndex, playlistLength: playlist.length });
        
        if (this.currentMode === this.PlayMode.SHUFFLE) {
            return this.playPreviousShuffle();
        }
        
        let prevIndex;
        
        if (currentIndex === -1) {
            prevIndex = playlist.length - 1;
        } else if (currentIndex > 0) {
            prevIndex = currentIndex - 1;
        } else {
            if (this.currentMode === this.PlayMode.LIST_LOOP) {
                prevIndex = playlist.length - 1;
            } else {
                prevIndex = 0;
            }
        }
        
        await this.playFile(playlist[prevIndex].id);
    }

    handleTrackEnded() {
        this.log.debug('Track ended, handling next action');
        
        if (this.currentMode === this.PlayMode.SINGLE_LOOP) {
            this.audioElement.currentTime = 0;
            this.audioElement.play().catch(error => {
                this.log.error('Failed to restart in single loop mode', error);
            });
        } else {
            this.next().catch(error => {
                this.log.error('Failed to play next song', error);
            });
        }
        
        if (this.onEnded) {
            this.onEnded();
        }
    }

    setPlayMode(mode) {
        if (!Object.values(this.PlayMode).includes(mode)) {
            const error = new Error(`Invalid playback mode: ${mode}`);
            this.log.error('Invalid playback mode', error);
            throw error;
        }
        
        this.log.info('Setting playback mode', { oldMode: this.currentMode, newMode: mode });
        this.currentMode = mode;
        
        if (mode !== this.PlayMode.SHUFFLE) {
            this.shuffleHistory = [];
            this.shuffleRemaining = [];
        }
        
        if (this.onModeChange) {
            this.onModeChange(mode);
        }
    }

    togglePlayMode() {
        const modes = Object.values(this.PlayMode);
        const currentIndex = modes.indexOf(this.currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        const nextMode = modes[nextIndex];
        
        this.setPlayMode(nextMode);
        return nextMode;
    }

    async playNextShuffle() {
        const playlist = this.fileManager.getPlaylist();
        if (playlist.length === 0) {
            this.log.warn('Cannot play next shuffle, playlist is empty');
            return;
        }
        
        if (this.shuffleRemaining.length === 0) {
            this.shuffleRemaining = [...Array(playlist.length).keys()];
            this.shuffleArray(this.shuffleRemaining);
            this.log.debug('Shuffled playlist', { shuffleRemaining: this.shuffleRemaining });
        }
        
        const nextIndex = this.shuffleRemaining.pop();
        this.shuffleHistory.push(nextIndex);
        
        this.log.debug('Playing next shuffle', { nextIndex, shuffleRemaining: this.shuffleRemaining.length });
        await this.playFile(playlist[nextIndex].id);
    }

    async playPreviousShuffle() {
        const playlist = this.fileManager.getPlaylist();
        if (playlist.length === 0 || this.shuffleHistory.length === 0) {
            this.log.warn('Cannot play previous shuffle', { playlistLength: playlist.length, shuffleHistory: this.shuffleHistory.length });
            return;
        }
        
        const prevIndex = this.shuffleHistory.pop();
        this.shuffleRemaining.push(prevIndex);
        
        this.log.debug('Playing previous shuffle', { prevIndex, shuffleRemaining: this.shuffleRemaining.length });
        await this.playFile(playlist[prevIndex].id);
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    setPlaybackRate(rate) {
        if (rate < 0.1 || rate > 4.0) {
            const error = new Error('Playback rate must be between 0.1 and 4.0');
            this.log.error('Invalid playback rate', error);
            throw error;
        }
        
        this.playbackRate = rate;
        this.audioElement.playbackRate = rate;
        this.log.debug('Playback rate set', { rate });
    }

    setVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.volume = clampedVolume;
        this.audioElement.volume = clampedVolume;
        this.log.debug('Volume set', { volume: clampedVolume });
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.audioElement.muted = this.isMuted;
        this.log.debug('Mute toggled', { muted: this.isMuted });
    }

    seek(time) {
        if (this.audioElement.duration && time >= 0 && time <= this.audioElement.duration) {
            this.audioElement.currentTime = time;
            this.currentTime = time;
            this.log.debug('Seek performed', { time });
        } else {
            this.log.warn('Invalid seek time', { time, duration: this.audioElement.duration });
        }
    }

    seekByPercentage(percentage) {
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        if (this.audioElement.duration) {
            const time = (clampedPercentage / 100) * this.audioElement.duration;
            this.seek(time);
        } else {
            this.log.warn('Cannot seek by percentage, no duration available');
        }
    }

    getCurrentPlaybackInfo() {
        const playlist = this.fileManager.getPlaylist();
        const currentIndex = playlist.findIndex(file => file.id === this.currentFileId);
        const currentFile = playlist[currentIndex] || null;
        
        return {
            isPlaying: this.isPlaying,
            currentFile: currentFile,
            currentIndex: currentIndex !== -1 ? currentIndex : null,
            currentTime: this.currentTime,
            duration: this.audioElement.duration || 0,
            volume: this.volume,
            isMuted: this.isMuted,
            playbackRate: this.playbackRate,
            playbackMode: this.currentMode,
            totalTracks: playlist.length,
            hasMediaSession: this.hasMediaSession,
            isLoading: this.isLoading
        };
    }

    setSilenceSkipperEnabled(enabled) {
        this.log.info('Setting silence skipper enabled', { enabled });
        this.silenceSkipperEnabled = enabled;
        
        if (this.skipEndedHandler) {
            if (enabled) {
                this.audioElement.removeEventListener('ended', this.skipEndedHandler);
            } else {
                this.audioElement.addEventListener('ended', this.skipEndedHandler);
            }
        }
    }

    destroy() {
        this.log.info('Destroying player controller');
        
        if (this.hasMediaSession) {
            try {
                navigator.mediaSession.metadata = null;
                const actions = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'];
                actions.forEach(action => {
                    try {
                        navigator.mediaSession.setActionHandler(action, null);
                    } catch (error) {
                        // Ignore errors when clearing handlers
                    }
                });
            } catch (error) {
                this.log.warn('Failed to clean up MediaSession', error);
            }
        }
        
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.removeAudioEventListeners();
            
            if (this.skipEndedHandler) {
                this.audioElement.removeEventListener('ended', this.skipEndedHandler);
            }
            
            this.audioElement = null;
        }
        
        this.fileManager = null;
        this.currentFileId = null;
        this.isPlaying = false;
        this.isLoading = false;

        this.onPlay = null;
        this.onPause = null;
        this.onSongChange = null;
        this.onTimeUpdate = null;
        this.onEnded = null;
        this.onError = null;
        this.onVolumeChange = null;
        this.onPlaybackRateChange = null;
        this.onModeChange = null;
        this.onLoadStart = null;
        this.onLoadedData = null;
        
        this.log.info('Player controller destroyed');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayerController;
}

if (typeof window !== 'undefined') {
    window.PlayerController = PlayerController;
}
