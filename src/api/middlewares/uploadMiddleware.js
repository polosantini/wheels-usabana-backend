const multer = require('multer');
const path = require('path');
const fs = require('fs');

// En Vercel, usar /tmp (único directorio escribible en serverless)
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const uploadBaseDir = isVercel ? '/tmp' : (process.env.UPLOAD_DIR || 'uploads');
const profileUploadDir = `${uploadBaseDir}/profiles`;
const vehicleUploadDir = `${uploadBaseDir}/vehicles`;

// Solo crear directorios si no estamos en Vercel o si no existen
if (!isVercel) {
  [profileUploadDir, vehicleUploadDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} else {
  // En Vercel, intentar crear directorios en /tmp (siempre disponible)
  try {
    [profileUploadDir, vehicleUploadDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  } catch (err) {
    console.warn('Could not create upload directories (using memory storage):', err.message);
  }
}

// Configuración de storage para perfiles de usuario
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profileUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Configuración de storage para vehículos
const vehicleStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, vehicleUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Filtro de archivos
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Only JPEG, PNG, and WebP are allowed.'), false);
  }
};

// Configuración de Multer para perfiles
const upload = multer({
  storage: profileStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_PROFILE_PHOTO_MB || '5') * 1024 * 1024 // 5MB por defecto
  }
});

// Configuración de Multer para vehículos (soporta múltiples archivos)
const vehicleUpload = multer({
  storage: vehicleStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_VEHICLE_PHOTO_MB || process.env.MAX_SOAT_PHOTO_MB || '5') * 1024 * 1024 // 5MB por defecto
  }
});

// Middleware para manejar errores de Multer
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 'payload_too_large',
        message: 'File exceeds limit',
        correlationId: req.correlationId
      });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        code: 'invalid_file_type',
        message: 'Unexpected file field',
        correlationId: req.correlationId
      });
    }
  }
  
  if (err && err.message === 'Unsupported file type. Only JPEG, PNG, and WebP are allowed.') {
    return res.status(400).json({
      code: 'invalid_file_type',
      message: 'Unsupported MIME type',
      correlationId: req.correlationId
    });
  }
  
  next(err);
};

/**
 * Middleware para cleanup automático de archivos en caso de error
 * Maneja tanto req.file (único) como req.files (múltiples)
 */
const cleanupOnError = async (req, res, next) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  /**
   * Función helper para limpiar archivos
   */
  const cleanupFiles = () => {
    // Solo limpiar si hay error (status >= 400)
    if (res.statusCode < 400) {
      return;
    }

    const filesToClean = [];

    // Manejar archivo único (req.file)
    if (req.file && req.file.path) {
      filesToClean.push(req.file.path);
    }

    // Manejar múltiples archivos (req.files)
    if (req.files) {
      // req.files puede ser un array o un objeto con arrays
      if (Array.isArray(req.files)) {
        // Array de archivos
        filesToClean.push(...req.files.map(f => f.path));
      } else {
        // Objeto con campos de archivos (ej: { vehiclePhoto: [...], soatPhoto: [...] })
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            filesToClean.push(...fileArray.map(f => f.path));
          }
        });
      }
    }

    // Eliminar archivos
    filesToClean.forEach(filePath => {
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting temp file ${filePath}:`, err);
        else console.log(`Cleaned up temp file: ${filePath}`);
      });
    });
  };

  // Interceptar res.send
  res.send = function(data) {
    cleanupFiles();
    return originalSend.call(this, data);
  };

  // Interceptar res.json
  res.json = function(data) {
    cleanupFiles();
    return originalJson.call(this, data);
  };
  
  next();
};

module.exports = {
  upload,
  vehicleUpload,
  handleUploadError,
  cleanupOnError
};

