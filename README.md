# NovaBuk Blog System - Setup Guide

## Backend Setup

### Prerequisites

- Node.js & npm installed
- MongoDB installed and running locally OR MongoDB Atlas account (cloud)

### Installation Steps

1. **Navigate to backend directory:**

```bash
cd backend
```

2. **Install dependencies:**

```bash
npm install
```

3. **Create .env file:**
   Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

4. **Configure MongoDB:**

**Option A: Local MongoDB**

```
MONGODB_URI=mongodb://localhost:27017/novabuk-blog
```

**Option B: MongoDB Atlas (Cloud)**

- Go to mongodb.com/cloud/atlas
- Create a cluster
- Get connection string
- Update in `.env`:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/novabuk-blog
```

5. **Update JWT Secret (Important for production):**

```
JWT_SECRET=your_super_secret_key_change_this_in_production
```

6. **Start the backend server:**

```bash
npm run dev
```

You should see:

```
✓ MongoDB Connected Successfully
🚀 NovaBuk Blog Backend running on http://localhost:5000
```

## Frontend Setup

1. **Update your main blog page to fetch from backend**
   - Update the blog fetching JavaScript to call the API

2. **Admin Dashboard Access:**
   - Open `admin-dashboard.html` in your browser
   - First time: Create admin account
   - Then: Login with your credentials

## API Endpoints

### Public (No Authentication Needed)

**Get all published blogs:**

```
GET /api/blogs?category=healthcare&search=query&page=1&limit=10
```

**Get featured blogs:**

```
GET /api/blogs/featured
```

**Get single blog by slug:**

```
GET /api/blogs/:slug
```

### Admin (Authentication Required)

**Login:**

```
POST /api/admin/login
Body: { email, password }
```

**Create blog post:**

```
POST /api/blogs
Headers: Authorization: Bearer {token}
Body: { title, content, category, excerpt, author, readTime, image }
```

**Update blog:**

```
PUT /api/blogs/:id
Headers: Authorization: Bearer {token}
Body: { ...updated fields }
```

**Publish blog:**

```
PATCH /api/blogs/:id/publish
Headers: Authorization: Bearer {token}
Body: { published: true/false }
```

**Delete blog:**

```
DELETE /api/blogs/:id
Headers: Authorization: Bearer {token}
```

## Using the Admin Dashboard

1. **Access dashboard:** `admin-dashboard.html`
2. **First Time:** Create admin account (only first can create account)
3. **Login:** With your email and password
4. **Create Blog:** Click "New Post" and fill in details
5. **Publish:** Click "Save & Publish" to make it live
6. **Edit:** Click edit on any blog to modify
7. **Delete:** Click delete to remove blog

## Frontend JavaScript Example

Update your blog page to fetch from backend:

```javascript
const API_URL = "http://localhost:5000/api";

async function loadBlogs() {
  try {
    const response = await fetch(`${API_URL}/blogs`);
    const data = await response.json();

    if (data.success) {
      // data.data contains array of blogs
      renderBlogs(data.data);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

function renderBlogs(blogs) {
  const container = document.getElementById("blogsGrid");
  blogs.forEach((blog) => {
    const html = `
            <article class="blog-card">
                <a href="./blog-post.html?slug=${blog.slug}">
                    <h3>${blog.title}</h3>
                    <p>${blog.excerpt}</p>
                    <div class="post-meta">
                        <span>${blog.author}</span>
                        <span>${blog.readTime} min read</span>
                    </div>
                </a>
            </article>
        `;
    container.innerHTML += html;
  });
}

loadBlogs();
```

## Troubleshooting

**MongoDB Connection Error:**

- Make sure MongoDB is running: `mongod`
- Check connection string in `.env`

**CORS Error:**

- The backend already has CORS enabled for all origins
- Make sure to include `Authorization` header for protected routes

**Admin Dashboard not loading blogs:**

- Check browser console for errors
- Verify backend is running on localhost:5000
- Check that at least one blog exists

## Production Deployment

1. Change NODE_ENV to 'production' in .env
2. Update MongoDB connection to production database
3. Use strong JWT_SECRET
4. Deploy backend to cloud (Heroku, Railway, etc.)
5. Update API_URL in frontend to production backend URL

## Support

For issues or questions, contact the NovaBuk development team.
