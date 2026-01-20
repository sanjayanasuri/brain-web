// Test script to create a task and test itinerary
// Run this in your browser console on http://localhost:3000/home

(async function() {
  console.log('🧪 Testing task creation and itinerary...\n');
  
  // Get auth token
  const tokenResponse = await fetch('/api/auth/token');
  const tokenData = await tokenResponse.json();
  const token = tokenData.token;
  console.log('✓ Got auth token');
  
  // Get tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  console.log(`✓ Target date: ${tomorrowStr} (tomorrow)\n`);
  
  // Create task
  console.log('📝 Creating task...');
  const taskResponse = await fetch('http://localhost:8000/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      title: 'Review Q4 financial reports',
      estimated_minutes: 90,
      priority: 'high',
      energy: 'high',
      due_date: tomorrowStr,
      preferred_time_windows: ['morning']
    })
  });
  
  if (taskResponse.ok) {
    const task = await taskResponse.json();
    console.log(`✓ Created task: "${task.title}"`);
    console.log(`  ID: ${task.id}`);
    console.log(`  Due: ${task.due_date}`);
    console.log(`  Priority: ${task.priority}, Energy: ${task.energy}\n`);
    
    // Now test the itinerary query
    console.log('📅 Testing itinerary query...');
    const chatResponse = await fetch('/api/brain-web/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "What's my plan tomorrow?",
        mode: 'graphrag',
        graph_id: 'default'
      })
    });
    
    if (chatResponse.ok) {
      const chatData = await chatResponse.json();
      console.log('\n📋 Response:');
      console.log(chatData.answer);
      console.log('\n✅ Test complete!');
    } else {
      console.error('✗ Chat API failed:', chatResponse.status);
      const error = await chatResponse.text();
      console.error(error);
    }
  } else {
    console.error('✗ Failed to create task:', taskResponse.status);
    const error = await taskResponse.text();
    console.error(error);
  }
})();
