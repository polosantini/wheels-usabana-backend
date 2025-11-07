const mongoose = require('mongoose');

// Definir el schema de User
const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    minlength: [2, 'First name must be at least 2 characters'],
    maxlength: [50, 'First name must not exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    minlength: [2, 'Last name must be at least 2 characters'],
    maxlength: [50, 'Last name must not exceed 50 characters']
  },
  corporateEmail: {
    type: String,
    required: [true, 'Corporate email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  universityId: {
    type: String,
    required: [true, 'University ID is required'],
    unique: true,
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required']
  },
  role: {
    type: String,
    required: [true, 'Role is required'],
    enum: {
      values: ['passenger', 'driver'],
      message: 'Role must be either passenger or driver'
    }
  },
  profilePhoto: {
    type: String,
    default: null
  },
  // Suspension fields for admin actions (US-8.2.1)
  suspended: {
    type: Boolean,
    default: false,
    index: true
  },
  suspendedAt: {
    type: Date,
    default: null
  },
  suspendedBy: {
    // Store admin identifier as string (can be objectId or external id)
    type: String,
    default: null
  },
  suspensionReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Suspension reason cannot exceed 500 characters'],
    default: ''
  },
  // Temporary publish ban fields (US-8.2.4)
  publishBanUntil: {
    type: Date,
    default: null,
    index: true
  },
  publishBanReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Publish ban reason cannot exceed 500 characters'],
    default: ''
  },
  publishBannedBy: {
    // Store admin identifier as string (can be ObjectId or external id)
    type: String,
    default: null
  },
  // Password reset fields
  resetPasswordToken: {
    type: String,
    default: null,
    select: false  // Never include in queries by default
  },
  resetPasswordExpires: {
    type: Date,
    default: null,
    select: false
  },
  resetPasswordConsumed: {
    type: Date,
    default: null,
    select: false
  },
  passwordChangedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,      // Crea createdAt y updatedAt automáticamente
  strict: true,          // Rechaza campos no definidos en el schema
  strictQuery: false     // Permite queries flexibles
});

// Pre-save hook para normalización adicional
userSchema.pre('save', function(next) {
  // Normalizar email a lowercase (aunque ya está en schema)
  if (this.corporateEmail) {
    this.corporateEmail = this.corporateEmail.toLowerCase();
  }
  
  // Normalizar phone a E.164 si es necesario
  if (this.phone && !this.phone.startsWith('+')) {
    this.phone = '+' + this.phone;
  }
  
  next();
});

// Crear el modelo
const UserModel = mongoose.model('User', userSchema);

module.exports = UserModel;

