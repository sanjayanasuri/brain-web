#!/bin/bash
# Helper script to view logs from the Hetzner server

# Default values - change these if your server configuration is different
SERVER_IP="demo.sanjayanasuri.com"
SERVER_USER="root" # Or your specific user

echo "📊 Brain Web Remote Log Viewer"
echo "=============================="
echo "Target: $SERVER_USER@$SERVER_IP"
echo ""

echo "Options:"
echo "  1. View Backend Logs (Real-time tail)"
echo "  2. View Nginx Access Logs"
echo "  3. View Nginx Error Logs"
echo "  4. Check Docker Container Status"
echo "  5. Custom SSH Command"
echo ""

read -p "Select option (1-5): " choice

case $choice in
  1)
    echo "👀 Tailoring backend logs..."
    ssh $SERVER_USER@$SERVER_IP "cd brain-web && docker compose logs -f backend"
    ;;
  2)
    echo "📡 Showing Nginx access logs..."
    ssh $SERVER_USER@$SERVER_IP "tail -f /var/log/nginx/access.log"
    ;;
  3)
    echo "❌ Showing Nginx error logs..."
    ssh $SERVER_USER@$SERVER_IP "tail -f /var/log/nginx/error.log"
    ;;
  4)
    echo "📋 Checking container status..."
    ssh $SERVER_USER@$SERVER_IP "cd brain-web && docker compose ps"
    ;;
  5)
    read -p "Enter SSH command: " cmd
    ssh $SERVER_USER@$SERVER_IP "$cmd"
    ;;
  *)
    echo "Invalid option."
    ;;
esac
