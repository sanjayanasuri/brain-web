#!/bin/bash
# Master Test Runner - Run all tests

echo "╔════════════════════════════════════════╗"
echo "║  BRAIN WEB - COMPREHENSIVE TEST SUITE  ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if server is running
echo "Checking if server is running..."
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "❌ Server is not running on http://localhost:8000"
    echo "Please start the backend server first:"
    echo "  cd backend && ./run.sh"
    exit 1
fi
echo "✅ Server is running"
echo ""

# Menu
echo "Select tests to run:"
echo "  1) Chat Features Only"
echo "  2) Adaptive Study System Only"
echo "  3) Custom Tutor Personas Only"
echo "  4) All Tests (Sequential)"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        echo ""
        echo "Running Chat Features Tests..."
        echo "=============================="
        ./test_chat_features.sh
        ;;
    2)
        echo ""
        echo "Running Adaptive Study System Tests..."
        echo "======================================="
        ./test_study_system.sh
        ;;
    3)
        echo ""
        echo "Running Custom Tutor Personas Tests..."
        echo "======================================="
        ./test_custom_tutor.sh
        ;;
    4)
        echo ""
        echo "Running ALL Tests..."
        echo "===================="
        echo ""
        
        echo "📝 Part 1: Custom Tutor Personas"
        echo "================================"
        ./test_custom_tutor.sh
        echo ""
        
        echo "💬 Part 2: Chat Features"
        echo "========================"
        ./test_chat_features.sh
        echo ""
        
        echo "🎓 Part 3: Adaptive Study System"
        echo "================================"
        ./test_study_system.sh
        echo ""
        
        echo "╔════════════════════════════════════════╗"
        echo "║      ALL TESTS COMPLETED! 🎉           ║"
        echo "╚════════════════════════════════════════╝"
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac
