const jwt = require('jsonwebtoken');
const ClinicStaff = require('../models/ClinicStaff');




const protectClinic = async (req, res, next) => {
    try {
        let token;

        if ( req.cookies && req.cookies.novabuk_clinic_token){
            token = req.cookies.novabuk_clinic_token;
        }

        if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if(!token) {
            return res.status(401).json({
                success: false,
                message: 'Not Authenticated, please Log in to the clinic portal'
            });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const staff = await ClinicStaff.findById(decoded.id)
        .populate('clinic', 'name location contactPhone isOpen isActive');

        if (!staff) {
            return res.status(401).json({
                success: false,
                message: "Staff account not found"
            });
        }

        if (!staff.isActive) {
            return res.status(401).json({
                success: false,
                message: "This account has been deactivated. contact your clinic Admin"
            });
        }
        
        req.staff = staff;
        req.clinicId = staff.clinic._id

        next();
    } catch(error) {
        return res.status(401).json({
            success: false,
            message: "Session expired or invalid. Please log in again."
        });
    }
};