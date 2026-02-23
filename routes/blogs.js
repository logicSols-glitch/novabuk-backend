const express = require("express");
const router = express.Router();
const {
  getAllBlogs,
  getFeaturedBlogs,
  getBlogBySlug,
  createBlog,
  updateBlog,
  publishBlog,
  deleteBlog,
  getAllBlogsAdmin,
  getBlogByIdAdmin,
} = require("../controllers/blogController");
const { protect, authorize } = require("../middleware/auth");

// Public routes
router.get("/", getAllBlogs);
router.get("/featured", getFeaturedBlogs);
router.get("/:slug", getBlogBySlug);

// Admin routes
router.get(
  "/admin/all",
  protect,
  authorize("admin", "editor"),
  getAllBlogsAdmin,
);
// Admin: get single blog by id (includes unpublished)
router.get(
  "/admin/:id",
  protect,
  authorize("admin", "editor"),
  getBlogByIdAdmin,
);
router.post("/", protect, authorize("admin", "editor"), createBlog);
router.put("/:id", protect, authorize("admin", "editor"), updateBlog);
router.patch("/:id/publish", protect, authorize("admin"), publishBlog);
router.delete("/:id", protect, authorize("admin"), deleteBlog);

module.exports = router;
