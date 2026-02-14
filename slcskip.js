/*
Silence Skipper for Lite Music Player
Lite Music Player version: 3.0
Silence Skipper version: 3.0
Copyright (c) 2026 the Lite developers. All rights reserved.
*/

class SilenceSkipper {
    constructor(playerController, fileManager) {
        this.player = playerController;
        this.fileManager = fileManager;
        this.isEnabled = false;
        this.silenceThreshold = -60;
        this.minSilenceDuration = 0.5;
        this.currentFileAnalysis = null;
        this.nextFileAnalysis = null;
        this.audioContext = null;
        this.skipInProgress = false;
        this.originalOnSongChange = null;
        this.onEnabled = null;
        this.onDisabled = null;
        this.onSkip = null;
        this.analyses = new Map();
        this.skipStartTimeout = null;
        this.endedListener = null;
        this.timeUpdateListener = null;
        this.songChangeListener = null;
        this.log = this.createLogger();
    }

    createLogger() {
        const PREFIX = '[SilenceSkipper]';
        return {
            info: (msg, data) => console.log(`${PREFIX} ${msg}`, data || ''),
            error: (msg, err) => console.error(`${PREFIX} ${msg}`, err || ''),
            warn: (msg, data) => console.warn(`${PREFIX} ${msg}`, data || ''),
            debug: (msg, data) => console.debug(`${PREFIX} ${msg}`, data || '')
        };
    }

    async enable() {
        if (this.isEnabled) {
            this.log.warn('Already enabled');
            return;
        }

        try {
            this.log.info('Enabling silence skipper');
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'playback'
            });
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            this.isEnabled = true;
            this.player.setSilenceSkipperEnabled(true);
            
            this.originalOnSongChange = this.player.onSongChange;
            this.songChangeListener = this.handleSongChange.bind(this);
            this.player.onSongChange = this.songChangeListener;
            
            this.endedListener = this.handleEnded.bind(this);
            this.player.audioElement.addEventListener('ended', this.endedListener);
            
            this.timeUpdateListener = this.handleTimeUpdate.bind(this);
            this.player.audioElement.addEventListener('timeupdate', this.timeUpdateListener);
            
            await this.analyzeCurrentAndNext();
            this.applyStartSkip();
            
            if (this.onEnabled) {
                this.onEnabled();
            }
            
            this.log.info('Silence skipper enabled');
            return true;
        } catch (error) {
            this.log.error('Failed to enable silence skipper', error);
            this.disable();
            throw error;
        }
    }

    disable() {
        if (!this.isEnabled) {
            return;
        }

        this.log.info('Disabling silence skipper');
        this.isEnabled = false;
        this.player.setSilenceSkipperEnabled(false);
        
        if (this.timeUpdateListener) {
            this.player.audioElement.removeEventListener('timeupdate', this.timeUpdateListener);
            this.timeUpdateListener = null;
        }
        
        if (this.endedListener) {
            this.player.audioElement.removeEventListener('ended', this.endedListener);
            this.endedListener = null;
        }
        
        if (this.songChangeListener && this.player.onSongChange === this.songChangeListener) {
            this.player.onSongChange = this.originalOnSongChange;
            this.songChangeListener = null;
        }
        
        this.clearTimeouts();
        
        if (this.audioContext) {
            if (this.audioContext.state !== 'closed') {
                this.audioContext.close().catch(() => {});
            }
            this.audioContext = null;
        }
        
        this.currentFileAnalysis = null;
        this.nextFileAnalysis = null;
        this.skipInProgress = false;
        
        if (this.onDisabled) {
            this.onDisabled();
        }
        
        this.log.info('Silence skipper disabled');
    }

    async analyzeCurrentAndNext() {
        if (!this.isEnabled) {
            return;
        }

        const playlist = this.fileManager.getPlaylist();
        if (playlist.length === 0) {
            this.log.debug('No files in playlist to analyze');
            return;
        }

        const currentIndex = playlist.findIndex(file => file.id === this.player.currentFileId);
        
        if (currentIndex !== -1) {
            const currentFile = playlist[currentIndex];
            if (!this.analyses.has(currentFile.id)) {
                this.log.debug('Analyzing current file', { file: currentFile.id });
                this.currentFileAnalysis = await this.analyzeFile(currentFile);
                if (this.currentFileAnalysis) {
                    this.analyses.set(currentFile.id, this.currentFileAnalysis);
                }
            } else {
                this.currentFileAnalysis = this.analyses.get(currentFile.id);
                this.log.debug('Using cached analysis for current file', { file: currentFile.id });
            }
        }
        
        if (currentIndex < playlist.length - 1) {
            const nextFile = playlist[currentIndex + 1];
            if (!this.analyses.has(nextFile.id)) {
                this.log.debug('Analyzing next file', { file: nextFile.id });
                this.nextFileAnalysis = await this.analyzeFile(nextFile);
                if (this.nextFileAnalysis) {
                    this.analyses.set(nextFile.id, this.nextFileAnalysis);
                }
            } else {
                this.nextFileAnalysis = this.analyses.get(nextFile.id);
                this.log.debug('Using cached analysis for next file', { file: nextFile.id });
            }
        } else {
            this.nextFileAnalysis = null;
            this.log.debug('No next file to analyze');
        }
    }

    async analyzeFile(file) {
        if (!file || !file.url) {
            this.log.warn('Invalid file for analysis', { file });
            return null;
        }

        if (this.analyses.has(file.id)) {
            return this.analyses.get(file.id);
        }

        try {
            this.log.debug('Starting file analysis', { file: file.id, name: file.fileName });
            
            const response = await fetch(file.url);
            if (!response.ok) {
                throw new Error(`Fetch failed with status ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const channelData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            
            const startSilence = this.detectStartSilence(channelData, sampleRate);
            const endSilence = this.detectEndSilence(channelData, sampleRate);
            
            const analysis = {
                fileId: file.id,
                duration: audioBuffer.duration,
                startSilence: Math.min(startSilence, audioBuffer.duration * 0.1),
                endSilence: Math.min(endSilence, audioBuffer.duration * 0.1),
                sampleRate: sampleRate
            };
            
            this.log.debug('File analysis completed', { 
                file: file.id, 
                duration: analysis.duration,
                startSilence: analysis.startSilence,
                endSilence: analysis.endSilence 
            });
            
            return analysis;
        } catch (error) {
            this.log.error('Failed to analyze file', { file: file.id, error });
            return null;
        }
    }

    detectStartSilence(channelData, sampleRate) {
        const threshold = Math.pow(10, this.silenceThreshold / 20);
        const minSilenceSamples = this.minSilenceDuration * sampleRate;
        const maxAnalyzeSamples = Math.min(channelData.length, sampleRate * 10);
        
        let silentSamples = 0;
        let maxSilentSamples = 0;
        
        for (let i = 0; i < maxAnalyzeSamples; i++) {
            if (Math.abs(channelData[i]) < threshold) {
                silentSamples++;
                if (silentSamples > maxSilentSamples) {
                    maxSilentSamples = silentSamples;
                }
            } else {
                if (silentSamples >= minSilenceSamples) {
                    return silentSamples / sampleRate;
                }
                silentSamples = 0;
            }
        }
        
        if (maxSilentSamples >= minSilenceSamples) {
            return maxSilentSamples / sampleRate;
        }
        
        return 0;
    }

    detectEndSilence(channelData, sampleRate) {
        const threshold = Math.pow(10, this.silenceThreshold / 20);
        const minSilenceSamples = this.minSilenceDuration * sampleRate;
        const maxAnalyzeSamples = Math.min(channelData.length, sampleRate * 10);
        
        let silentSamples = 0;
        let maxSilentSamples = 0;
        
        const startIndex = Math.max(0, channelData.length - maxAnalyzeSamples);
        
        for (let i = channelData.length - 1; i >= startIndex; i--) {
            if (Math.abs(channelData[i]) < threshold) {
                silentSamples++;
                if (silentSamples > maxSilentSamples) {
                    maxSilentSamples = silentSamples;
                }
            } else {
                if (silentSamples >= minSilenceSamples) {
                    return silentSamples / sampleRate;
                }
                break;
            }
        }
        
        if (maxSilentSamples >= minSilenceSamples) {
            return maxSilentSamples / sampleRate;
        }
        
        return 0;
    }

    handleTimeUpdate() {
        if (!this.isEnabled || !this.currentFileAnalysis || this.skipInProgress) {
            return;
        }
        
        const currentTime = this.player.currentTime;
        const duration = this.currentFileAnalysis.duration;
        const endSilenceStart = duration - this.currentFileAnalysis.endSilence;
        
        if (currentTime >= endSilenceStart && this.nextFileAnalysis) {
            this.log.debug('Detected end silence, performing skip', {
                currentTime,
                duration,
                endSilenceStart,
                endSilence: this.currentFileAnalysis.endSilence
            });
            this.performEndSkip();
        }
    }

    handleEnded() {
        if (!this.isEnabled) {
            return;
        }
        
        if (this.player.currentMode === this.player.PlayMode.SINGLE_LOOP) {
            this.player.audioElement.currentTime = 0;
            this.player.audioElement.play().catch(error => {
                this.log.error('Failed to play in single loop mode', error);
            });
        } else {
            this.player.next().catch(error => {
                this.log.error('Failed to play next song', error);
            });
        }
        
        if (this.player.onEnded) {
            this.player.onEnded();
        }
    }

    applyStartSkip() {
        if (!this.isEnabled || !this.currentFileAnalysis || this.skipInProgress) {
            return;
        }
        
        const startSilence = this.currentFileAnalysis.startSilence;
        
        if (startSilence > 0 && this.player.currentTime < startSilence) {
            this.log.debug('Applying start silence skip', { startSilence });
            this.player.seek(startSilence);
        }
    }

    async performEndSkip() {
        if (!this.nextFileAnalysis || this.skipInProgress || !this.isEnabled) {
            return;
        }
        
        this.skipInProgress = true;
        this.log.debug('Performing end skip');
        
        const playlist = this.fileManager.getPlaylist();
        const currentIndex = playlist.findIndex(file => file.id === this.player.currentFileId);
        
        if (currentIndex < playlist.length - 1) {
            const nextFile = playlist[currentIndex + 1];
            
            if (this.player.currentMode === this.player.PlayMode.SINGLE_LOOP) {
                this.player.audioElement.currentTime = 0;
                this.player.audioElement.play().catch(error => {
                    this.log.error('Failed to restart in single loop mode', error);
                });
                this.skipInProgress = false;
                return;
            }
            
            if (this.player.currentMode === this.player.PlayMode.SHUFFLE) {
                try {
                    await this.player.playNextShuffle();
                } catch (error) {
                    this.log.error('Failed to play next shuffle', error);
                }
                this.skipInProgress = false;
                return;
            }
            
            try {
                await this.player.playFile(nextFile.id);
                
                if (this.onSkip) {
                    this.onSkip(this.currentFileAnalysis.fileId, nextFile.id);
                }
                
                this.log.debug('End skip completed', { 
                    from: this.currentFileAnalysis.fileId, 
                    to: nextFile.id 
                });
            } catch (error) {
                this.log.error('End skip failed', error);
            }
        } else {
            if (this.player.currentMode === this.player.PlayMode.LIST_LOOP) {
                const firstFile = playlist[0];
                if (firstFile) {
                    try {
                        await this.player.playFile(firstFile.id);
                    } catch (error) {
                        this.log.error('Failed to play first file in list loop', error);
                    }
                    this.skipInProgress = false;
                    return;
                }
            }
            
            this.player.pause();
            this.player.currentFileId = null;
            if (this.player.onSongChange) {
                this.player.onSongChange(null);
            }
        }
        
        this.skipInProgress = false;
    }

    async handleSongChange(file) {
        if (!this.isEnabled) {
            return;
        }
        
        this.log.debug('Handling song change', { file: file?.id });
        this.skipInProgress = false;
        this.clearTimeouts();
        
        await this.analyzeCurrentAndNext();
        
        if (file && this.currentFileAnalysis && this.currentFileAnalysis.startSilence > 0) {
            this.skipStartTimeout = setTimeout(() => {
                if (this.isEnabled && this.player.currentFileId === file.id) {
                    this.applyStartSkip();
                }
            }, 100);
        }
        
        if (this.originalOnSongChange) {
            this.originalOnSongChange(file);
        }
    }

    clearTimeouts() {
        if (this.skipStartTimeout) {
            clearTimeout(this.skipStartTimeout);
            this.skipStartTimeout = null;
        }
    }

    setSilenceThreshold(thresholdDB) {
        const newThreshold = Math.max(-100, Math.min(0, thresholdDB));
        this.log.debug('Setting silence threshold', { old: this.silenceThreshold, new: newThreshold });
        this.silenceThreshold = newThreshold;
        this.analyses.clear();
    }

    setMinSilenceDuration(duration) {
        const newDuration = Math.max(0.1, Math.min(5, duration));
        this.log.debug('Setting min silence duration', { old: this.minSilenceDuration, new: newDuration });
        this.minSilenceDuration = newDuration;
        this.analyses.clear();
    }

    destroy() {
        this.log.info('Destroying silence skipper');
        this.disable();
        this.player = null;
        this.fileManager = null;
        this.onEnabled = null;
        this.onDisabled = null;
        this.onSkip = null;
        this.analyses.clear();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SilenceSkipper;
}

if (typeof window !== 'undefined') {
    window.SilenceSkipper = SilenceSkipper;
}
