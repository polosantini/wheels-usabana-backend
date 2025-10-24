class User {
    constructor({
        id, firstName, lastName, universityId, corporateEmail, phone, password, role, profilePhoto = null, createdAt, updatedAt
    }) {
        this.id = id;
        this.firstName = firstName;
        this.lastName = lastName;
        this.universityId = universityId;
        this.corporateEmail = corporateEmail;
        this.phone = phone;
        this.password = password;
        this.role = role;
        this.profilePhoto = profilePhoto;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    //Método para mapear desde un documento de MongoDB:
    static fromDocument(doc) {
        return new User({
            id: doc._id.toString(),
            firstName: doc.firstName,
            lastName: doc.lastName,
            universityId: doc.universityId,
            corporateEmail: doc.corporateEmail,
            phone: doc.phone,
            password: doc.password,
            role: doc.role,
            profilePhoto: doc.profilePhoto,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        });
    }

    //Método para verificar si es un conductor:
    isDriver() {
        return this.role === 'driver';
    }

    //Método para verificar si es un pasajero:
    isPassenger() {
        return this.role === 'passenger';
    }
}

module.exports = User;

