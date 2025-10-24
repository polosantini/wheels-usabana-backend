class CreateUserDto {
  constructor({ 
    firstName, 
    lastName, 
    universityId, 
    corporateEmail, 
    phone, 
    password, 
    role, 
    profilePhoto = null 
  }) {
    this.firstName = firstName;
    this.lastName = lastName;
    this.universityId = universityId;
    this.corporateEmail = corporateEmail;
    this.phone = phone;
    this.password = password;
    this.role = role; // 'passenger' o 'driver'
    this.profilePhoto = profilePhoto; // Opcional
  }

  // Método estático para crear desde request body
  static fromRequest(body) {
    return new CreateUserDto({
      firstName: body.firstName,
      lastName: body.lastName,
      universityId: body.universityId,
      corporateEmail: body.corporateEmail,
      phone: body.phone,
      password: body.password,
      role: body.role,
      profilePhoto: body.profilePhoto || null
    });
  }
}

module.exports = CreateUserDto;

