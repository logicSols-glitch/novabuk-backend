const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const ClinicStaff = require('../models/ClinicStaff');
const clinic = require('../models/Clinic');
const { protectClinic } = require('../middleware/authClinic');
const { protectAdmin } = require('../middleware/auth')

// JWT generator
const generateToken = (id) => 
    jwt.sign({id}, process.env.JWT_SECRET, { expiresIn: '30d'});

const setClinicCookie = (res, token) => {
    res.cookie('novabuk_clinic_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        // none for cors and las for local dev

        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    });
};

router.post('/login', async ( req, res) => {
    try{
        const {email, password} = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password required.',
            });
        }

        const staff = await ClinicStaff.findOne({ email: email.toLowerCase() })
        .select("+password")
        .populate("clinic", "name location isOpen isActive");

        if (!staff) {
            return res.status(401).json({
               success: false,
               message: 'Incorrect email or password.', 
            });
        }

        const passwordMatch = await staff.comparePassword(password);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'Email and password required.',
            })
        }

        if(!staff.isActive) {
            return res.status(401).json({
                success: false,
                message: 'This account has been deactivated. contact your clinic Admin',
            });
        }

        const token = generateToken(staff._id);

        setClinicCookie(res, token);

        res.json({
            success: true,
            staff: {
                id :  staff._id,
                fullName: staff.fullName,
                email: staff.email,
                role: staff.role,
                clinic: {
                    id: staff.clinic._id,
                    name: staff.clinic.name,
                },
            },

        });
    }catch(error){
        console.error('clinic login error:', error);
        res.status(500).json({success: false, message: "Server error"});
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('novabuk_clinic_token', {
        httpOnly : true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });
    res.json({ sucess:true, message: 'Logged Out'})
});

router.get('/me', protectClinic, (req, res) => {
    res.json({
        success: true,
        staff: {
            id :  staff._id,
            fullName: staff.fullName,
            email: staff.email,
            role: staff.role,
            clinic: {
                id: staff.clinic._id,
                name: staff.clinic.name,
            },
        },

    });
});

router.post('/register-staff', protectAdmin, async ( req, res)=> {
    try{
        const { clinicId, fullName, email, password, role } = req.body;
        
        if (!clinicId || !fullName || !email || !password) {
            return res.status(401).json({success: false, message: 'clinicId, fullName, email and password are all required.',});
        }

        // Verify the clinic exists
        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(401).json({success: false, message: 'clinic not found.',});
        }

        // check for duplicate email
        const existing = await ClinicStaff.findOne({email: email.toLowerCase()});
        if (existing) {
            return res.status(401).json({success: false, message: 'A staff account with this email already exists.',});
        }

        const staff = await ClinicStaff.create({
            clinic: clinicId,
            fullName,
            email,
            password,
            role: role||'doctor',
        });

        res.status(201).json({
            success: true,
            message: 'Staff account created successfully.',
            staff: {
                id: staff._id,
                fullName: staff.fullName,
                email: staff.email,
                role: staff.role,
                clinic: {
                    id: staff.clinic._id,
                    name: staff.clinic.name,
                },
            },
        });
    } catch (error) {
        console.error('Error registering clinic staff:', error);
        res.status(500).json({ success: false, message: 'Server error' });

    }
});

// ===== GET ALL STAFF FOR A CLINIC (ADMIN ONLY) =====
router.get('/staff', protectAdmin, async (req, res) => {
    try {
        const staff = await ClinicStaff.find({ clinic: req.admin.clinic })
        .select('-password')
        .populate('clinic', 'name')
        .sort({ createdAt: -1 });
        res.json({
            success: true,
            count: staff.length,
            data: staff,
        });
    } catch (error) {
        console.error('Error fetching clinic staff:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});



module.exports = router;