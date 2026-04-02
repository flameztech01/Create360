import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../utils/cloudinary.js';

// Configure Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isAudio = file.mimetype.startsWith('audio/');
    return {
      folder: 'chat-media',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'mp4', 'mov', 'm4a', 'mp3', 'wav', 'aac'],
      resource_type: isAudio ? 'video' : 'auto', // Cloudinary treats audio as video
    };
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // Increase to 25MB for audio files
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      // Images
      'image/jpeg', 'image/png', 'image/gif',
      // Documents
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Videos
      'video/mp4', 'video/quicktime',
      // Audio - ADD THESE
      'audio/mpeg',      // mp3
      'audio/mp4',       // m4a, mp4 audio
      'audio/x-m4a',     // m4a
      'audio/wav',       // wav
      'audio/aac',       // aac
      'audio/amr'        // amr (common for voice notes)
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.log('Rejected file type:', file.mimetype);
      cb(new Error('Invalid file type'), false);
    }
  }
});

export default upload;