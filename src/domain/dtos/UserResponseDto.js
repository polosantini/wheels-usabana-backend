class UserResponseDto {
  constructor({ 
    id, 
    firstName, 
    lastName, 
    universityId, 
    corporateEmail, 
    phone, 
    role, 
    profilePhotoUrl = null,
    createdAt,
    updatedAt
  }) {
    this.id = id;
    this.firstName = firstName;
    this.lastName = lastName;
    this.universityId = universityId;
    this.corporateEmail = corporateEmail;
    this.phone = phone;
    this.role = role;
    this.profilePhotoUrl = profilePhotoUrl; // URL, no path interno
    
    // Si es driver, incluir objeto driver
    if (role === 'driver') {
      this.driver = {
        hasVehicle: false // Por defecto false en registro inicial
      };
    }
    
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  // Método estático para crear desde entidad User
  static fromEntity(user) {
    return new UserResponseDto({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      universityId: user.universityId,
      corporateEmail: user.corporateEmail,
      phone: user.phone,
      role: user.role,
      profilePhotoUrl: user.profilePhoto, // Convertir a URL si es necesario
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  }

  // Método estático para crear desde documento MongoDB
  static fromDocument(doc) {
    return new UserResponseDto({
      id: doc._id.toString(), // Convertir _id a id
      firstName: doc.firstName,
      lastName: doc.lastName,
      universityId: doc.universityId,
      corporateEmail: doc.corporateEmail,
      phone: doc.phone,
      role: doc.role,
      profilePhotoUrl: doc.profilePhoto,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }
}

module.exports = UserResponseDto;

