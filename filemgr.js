/*
File Manager for Lite Music Player
Lite Music Player version: 3.0
File Manager version: 3.0
Copyright (c) 2026 the Lite developers. All rights reserved.
*/

class FileManager {
    constructor() {
        this.playlist = [];
        this.currentIndex = 0;
        this.isInitialized = false;
        this.supportedFormats = ['mp3', 'flac', 'ogg', 'wav', 'm4a', 'aac'];
        this.cachedDurations = new Map();
        this.log = this.createLogger();
    }

    createLogger() {
        const PREFIX = '[FileManager]';
        return {
            info: (msg, data) => console.log(`${PREFIX} ${msg}`, data || ''),
            error: (msg, err) => console.error(`${PREFIX} ${msg}`, err || ''),
            warn: (msg, data) => console.warn(`${PREFIX} ${msg}`, data || ''),
            debug: (msg, data) => console.debug(`${PREFIX} ${msg}`, data || '')
        };
    }

    initialize() {
        if (this.isInitialized) {
            this.log.warn('Already initialized');
            return;
        }
        
        this.playlist = [];
        this.currentIndex = 0;
        this.isInitialized = true;
        this.cachedDurations.clear();
        this.log.info('Initialized');
    }

    async addFiles(files) {
        if (!this.isInitialized) {
            this.initialize();
        }

        const fileArray = Array.from(files);
        this.log.info('Adding files', { count: fileArray.length });

        const processingPromises = fileArray.map(file => this.processFile(file));
        const processedFiles = await Promise.allSettled(processingPromises);
        
        const validFiles = processedFiles
            .filter(result => result.status === 'fulfilled' && result.value !== null)
            .map(result => result.value);

        const failedFiles = processedFiles
            .filter(result => result.status === 'rejected')
            .map(result => result.reason);

        if (failedFiles.length > 0) {
            this.log.warn('Some files failed to process', { failed: failedFiles.length });
        }

        this.playlist.push(...validFiles);
        this.sortPlaylist();
        
        this.log.info('Files added successfully', { 
            total: validFiles.length, 
            failed: failedFiles.length,
            newPlaylistSize: this.playlist.length 
        });
        
        return this.playlist;
    }

    async processFile(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        if (!this.supportedFormats.includes(extension)) {
            this.log.warn('Unsupported format', { file: file.name, extension });
            return null;
        }

        try {
            const metadata = await this.parseMetadata(file);
            const fileObject = {
                id: this.generateUniqueId(),
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                file: file,
                url: URL.createObjectURL(file),
                metadata: {
                    title: metadata.title || this.extractTitleFromFilename(file.name),
                    artist: metadata.artist || 'Unknown Artist',
                    album: metadata.album || 'Unknown Album',
                    year: metadata.year || '',
                    trackNumber: metadata.trackNumber || 0,
                    genre: metadata.genre || '',
                    picture: metadata.picture || null,
                    duration: metadata.duration || 0
                },
                addedAt: new Date().toISOString()
            };

            this.log.debug('File processed', { 
                id: fileObject.id, 
                title: fileObject.metadata.title,
                duration: fileObject.metadata.duration 
            });
            
            return fileObject;
        } catch (error) {
            this.log.error('Failed to process file', { file: file.name, error });
            return null;
        }
    }

    parseMetadata(file) {
        return new Promise((resolve, reject) => {
            if (typeof jsmediatags === 'undefined') {
                const error = new Error('jsmediatags library not loaded');
                this.log.error('Metadata parsing failed', error);
                reject(error);
                return;
            }

            jsmediatags.read(file, {
                onSuccess: (tag) => {
                    const tags = tag.tags;
                    const metadata = {
                        title: tags.title,
                        artist: tags.artist,
                        album: tags.album,
                        year: tags.year,
                        trackNumber: this.parseTrackNumber(tags.track),
                        genre: tags.genre,
                        picture: null,
                        pictureFormat: null,
                        duration: 0
                    };

                    if (tags.picture) {
                        const picture = tags.picture;
                        const base64String = this.arrayBufferToBase64(picture.data);
                        let mimeType = 'image/jpeg';
                        if (picture.format) {
                            if (picture.format.includes('png')) mimeType = 'image/png';
                            else if (picture.format.includes('gif')) mimeType = 'image/gif';
                            else if (picture.format.includes('bmp')) mimeType = 'image/bmp';
                        }
                        metadata.picture = `data:${picture.format};base64,${base64String}`;
                    }

                    const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
                    if (this.cachedDurations.has(cacheKey)) {
                        metadata.duration = this.cachedDurations.get(cacheKey);
                        resolve(metadata);
                        return;
                    }

                    this.getAudioDuration(file).then(duration => {
                        metadata.duration = duration;
                        this.cachedDurations.set(cacheKey, duration);
                        resolve(metadata);
                    }).catch((error) => {
                        this.log.warn('Could not get audio duration', { file: file.name, error });
                        resolve(metadata);
                    });
                },
                onError: (error) => {
                    this.log.debug('Metadata parsing fallback', { file: file.name, error });
                    resolve({
                        title: '',
                        artist: '',
                        album: '',
                        year: '',
                        trackNumber: 0,
                        genre: '',
                        picture: null,
                        duration: 0
                    });
                }
            });
        });
    }

    async getAudioDuration(file) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.preload = 'metadata';
            
            let timeoutId = setTimeout(() => {
                this.log.warn('Audio duration timeout', { file: file.name });
                audio.onloadedmetadata = null;
                audio.onerror = null;
                URL.revokeObjectURL(audio.src);
                resolve(0);
            }, 5000);
            
            audio.onloadedmetadata = () => {
                clearTimeout(timeoutId);
                resolve(audio.duration);
                URL.revokeObjectURL(audio.src);
            };
            
            audio.onerror = () => {
                clearTimeout(timeoutId);
                this.log.warn('Audio duration extraction failed', { file: file.name });
                resolve(0);
                URL.revokeObjectURL(audio.src);
            };
            
            audio.src = URL.createObjectURL(file);
        });
    }

    sortPlaylist() {
        this.playlist.sort((a, b) => {
            const trackA = a.metadata.trackNumber || 0;
            const trackB = b.metadata.trackNumber || 0;
            
            if (trackA !== 0 && trackB !== 0) {
                return trackA - trackB;
            }
            
            if (trackA !== 0) return -1;
            if (trackB !== 0) return 1;
            
            return a.fileName.localeCompare(b.fileName);
        });
        this.log.debug('Playlist sorted');
    }

    extractTitleFromFilename(filename) {
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
        return nameWithoutExt
            .replace(/^\d+\s*[-.]?\s*/, '')
            .replace(/[_-]/g, ' ')
            .trim();
    }

    parseTrackNumber(trackString) {
        if (trackString === undefined || trackString === null) {
            return 0;
        }
    
        const str = String(trackString);
    
        if (str.trim().length === 0) {
            return 0;
        }
    
        const match = str.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    generateUniqueId() {
        return 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getPlaylist() {
        return [...this.playlist];
    }

    getFileById(id) {
        const file = this.playlist.find(file => file.id === id) || null;
        this.log.debug('Get file by ID', { id, found: !!file });
        return file;
    }

    getFileByIndex(index) {
        const file = this.playlist[index] || null;
        this.log.debug('Get file by index', { index, found: !!file });
        return file;
    }

    removeFile(id) {
        const initialLength = this.playlist.length;
        const fileIndex = this.playlist.findIndex(file => file.id === id);
        
        if (fileIndex === -1) {
            this.log.warn('File not found for removal', { id });
            return false;
        }
        
        const removedFile = this.playlist[fileIndex];
        this.playlist.splice(fileIndex, 1);
        
        if (removedFile && removedFile.url) {
            URL.revokeObjectURL(removedFile.url);
            this.log.debug('URL revoked for removed file', { id });
        }
        
        this.log.info('File removed', { 
            id, 
            title: removedFile.metadata.title,
            remaining: this.playlist.length 
        });
        
        return true;
    }

    clearPlaylist() {
        const count = this.playlist.length;
        
        this.playlist.forEach(file => {
            if (file.url) {
                URL.revokeObjectURL(file.url);
            }
        });
        
        this.playlist = [];
        this.currentIndex = 0;
        this.cachedDurations.clear();
        
        this.log.info('Playlist cleared', { removedCount: count });
    }

    getStats() {
        const totalDuration = this.playlist.reduce((sum, file) => sum + (file.metadata.duration || 0), 0);
        const totalSize = this.playlist.reduce((sum, file) => sum + (file.fileSize || 0), 0);
        
        const stats = {
            totalFiles: this.playlist.length,
            totalDuration: totalDuration,
            totalSize: totalSize,
            artists: [...new Set(this.playlist.map(f => f.metadata.artist).filter(Boolean))],
            albums: [...new Set(this.playlist.map(f => f.metadata.album).filter(Boolean))]
        };
        
        this.log.debug('Stats calculated', stats);
        return stats;
    }

    search(query) {
        const searchTerm = query.toLowerCase().trim();
        if (!searchTerm) {
            return [...this.playlist];
        }
        
        const results = this.playlist.filter(file => {
            return (
                file.metadata.title.toLowerCase().includes(searchTerm) ||
                file.metadata.artist.toLowerCase().includes(searchTerm) ||
                file.metadata.album.toLowerCase().includes(searchTerm) ||
                file.fileName.toLowerCase().includes(searchTerm)
            );
        });
        
        this.log.debug('Search performed', { query, results: results.length });
        return results;
    }

    destroy() {
        this.clearPlaylist();
        this.isInitialized = false;
        this.cachedDurations.clear();
        this.log.info('Destroyed');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileManager;
}

if (typeof window !== 'undefined') {
    window.FileManager = FileManager;
}
