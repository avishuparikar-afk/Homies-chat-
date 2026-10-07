const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Group name is required'],
      trim: true,
      minlength: [3, 'Group name must be at least 3 characters'],
      maxlength: [50, 'Group name cannot exceed 50 characters']
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [200, 'Group description cannot exceed 200 characters']
    },
    image: {
      type: String,
      default: '👥'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ]
  },
  {
    timestamps: true
  }
);

groupSchema.index({ members: 1 });
groupSchema.index({ members: 1, updatedAt: -1 });
groupSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Group', groupSchema);
