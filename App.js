import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  Platform,
  StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import axios from 'axios';

// For PC testing, use localhost. For phone testing, use your IP.
const API_BASE_URL = 'http://localhost:8000';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [userName, setUserName] = useState('');
  const [isNameSet, setIsNameSet] = useState(false);
  const [inputName, setInputName] = useState('');
  const [expoPushToken, setExpoPushToken] = useState('');
  const [currentMeal, setCurrentMeal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notificationModalVisible, setNotificationModalVisible] = useState(false);
  const [receivedData, setReceivedData] = useState(null);

  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    checkName();
    registerForPushNotificationsAsync().then(token => {
      if (token) setExpoPushToken(token);
    });

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      setReceivedData(notification.request.content.data);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const { actionIdentifier, notification } = response;
      const data = notification.request.content.data;

      if (actionIdentifier === 'JOIN') {
        handleRSVP('join', data.creator_name);
      } else if (actionIdentifier === 'SKIP') {
        handleRSVP('not_coming', data.creator_name);
      } else {
        setReceivedData(data);
        setNotificationModalVisible(true);
      }
    });

    fetchCurrentMeal();
    const interval = setInterval(() => {
      fetchCurrentMeal();
    }, 5000);

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (isNameSet) {
      registerUserOnBackend();
    }
  }, [isNameSet, expoPushToken]);

  const checkName = async () => {
    const savedName = await AsyncStorage.getItem('userName');
    if (savedName) {
      setUserName(savedName);
      setIsNameSet(true);
    }
  };

  const handleSaveName = async () => {
    if (inputName.trim().length < 2) {
      Alert.alert('Error', 'Please enter a valid name');
      return;
    }
    await AsyncStorage.setItem('userName', inputName.trim());
    setUserName(inputName.trim());
    setIsNameSet(true);
  };

  const registerUserOnBackend = async () => {
    try {
      await axios.post(`${API_BASE_URL}/register`, {
        name: userName,
        push_token: expoPushToken || `web-${Math.random().toString(36).substr(2, 9)}`
      });
    } catch (error) {
      console.error('Registration failed');
    }
  };

  const fetchCurrentMeal = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/meal/current`);
      if (response.data.status !== 'no_active_meal') {
        setCurrentMeal(response.data);
      } else {
        setCurrentMeal(null);
      }
    } catch (error) {
      console.error('Fetch meal failed');
    }
  };

  const triggerMeal = async (type) => {
    setLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/meal`, {
        meal_type: type,
        creator_name: userName
      });
      fetchCurrentMeal();
    } catch (error) {
      Alert.alert('Error', 'Could not notify others');
    } finally {
      setLoading(false);
    }
  };

  const handleRSVP = async (status) => {
    try {
      let activeName = userName;
      if (!activeName) {
        activeName = await AsyncStorage.getItem('userName');
      }
      if (!activeName) return;

      await axios.post(`${API_BASE_URL}/meal/rsvp`, {
        name: activeName,
        status: status
      });
      setNotificationModalVisible(false);
      fetchCurrentMeal();
    } catch (error) {
      console.error('RSVP failed', error);
    }
  };

  async function registerForPushNotificationsAsync() {
    if (Platform.OS === 'web') return null;
    let token;
    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return null;

      try {
        token = (await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        })).data;
      } catch (e) {
        console.log("Push token error", e);
      }
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('meal-pings', {
        name: 'Meal Pings',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500, 200, 500, 200, 500, 200, 500],
        lightColor: '#FF6B6B',
        lockscreenVisibility: Notifications.AndroidLockscreenVisibility.PUBLIC,
        bypassDnd: true,
      });
    }

    // Set up notification categories (Join/Skip buttons)
    await Notifications.setNotificationCategoryAsync('MEAL_INVITATION', [
      {
        identifier: 'JOIN',
        buttonTitle: 'Count me in! ✅',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'SKIP',
        buttonTitle: 'Can\'t make it ❌',
        options: { opensAppToForeground: false },
      },
    ]);

    return token;
  }

  const getTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  if (!isNameSet) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.onboardingCard}>
          <View style={styles.logoBadge}><Text style={styles.logoEmoji}>🍱</Text></View>
          <Text style={styles.titleText}>Hostel Meal Ping</Text>
          <Text style={styles.subtitleText}>Notify friends when you're heading for food!</Text>
          <TextInput
            style={styles.inputField}
            placeholder="Your Name (e.g. Harsh)"
            placeholderTextColor="#ADB5BD"
            value={inputName}
            onChangeText={setInputName}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleSaveName}>
            <Text style={styles.primaryButtonText}>Start Pinging</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.topHeader}>
          <View>
            <Text style={styles.welcomeText}>Hey, {userName}! 👋</Text>
            <Text style={styles.statusSub}>What's the plan for today?</Text>
          </View>
          <View style={styles.profileCircle}><Text style={styles.profileText}>{userName[0]}</Text></View>
        </View>

        <Text style={styles.sectionHeader}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {[
            { label: 'Breakfast', emoji: '☕', color: '#FFD43B' },
            { label: 'Lunch', emoji: '🍲', color: '#51CF66' },
            { label: 'Dinner', emoji: '🥘', color: '#FF922B' }
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.actionCard, loading && styles.disabled]}
              onPress={() => triggerMeal(item.label)}
              disabled={loading}
            >
              <View style={[styles.emojiBg, { backgroundColor: item.color + '20' }]}>
                <Text style={styles.cardEmoji}>{item.emoji}</Text>
              </View>
              <Text style={styles.cardLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>Live Activity</Text>
        {currentMeal ? (
          <View style={styles.liveCard}>
            <View style={styles.liveTag}><View style={styles.pulse} /><Text style={styles.tagText}>ACTIVE NOW</Text></View>
            <View style={styles.liveContent}>
              <Text style={styles.liveMealTitle}>{currentMeal.meal_type} Invitation</Text>
              <Text style={styles.liveTime}>{currentMeal.creator_name} started this {getTimeAgo(currentMeal.created_at)}</Text>
            </View>

            <View style={styles.rsvpStack}>
              <TouchableOpacity
                style={[styles.rsvpBtn, styles.btnIn, (currentMeal.joining.includes(userName)) && styles.activeIn]}
                onPress={() => handleRSVP('join')}
              >
                <Text style={[styles.rsvpBtnText, { color: '#51CF66' }]}>Counting me in</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rsvpBtn, styles.btnOut, (currentMeal.not_coming.includes(userName)) && styles.activeOut]}
                onPress={() => handleRSVP('not_coming')}
              >
                <Text style={[styles.rsvpBtnText, { color: '#FF6B6B' }]}>Can't make it</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.guestList}>
              <View style={styles.guestSection}>
                <Text style={styles.guestTitle}>Joining ({currentMeal.joining.length})</Text>
                <View style={styles.avatarRow}>
                  {currentMeal.joining.length === 0 ? <Text style={styles.emptyGuest}>No one yet</Text> :
                    currentMeal.joining.map((name, i) => (
                      <View key={i} style={styles.guestBadge}><Text style={styles.badgeText}>{name}</Text></View>
                    ))
                  }
                </View>
              </View>
              <View style={styles.guestSection}>
                <Text style={styles.guestTitle}>Not Coming ({currentMeal.not_coming.length})</Text>
                <View style={styles.avatarRow}>
                  {currentMeal.not_coming.length === 0 ? <Text style={styles.emptyGuest}>No one yet</Text> :
                    currentMeal.not_coming.map((name, i) => (
                      <View key={i} style={[styles.guestBadge, { backgroundColor: '#F1F3F5' }]}><Text style={[styles.badgeText, { color: '#868E96' }]}>{name}</Text></View>
                    ))
                  }
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.emptyStateContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>Nothing's happening</Text>
            <Text style={styles.emptyText}>Be the first to ping everyone and head to the mess!</Text>
          </View>
        )}
      </ScrollView>

      {/* Notification Modal */}
      <Modal animationType="fade" transparent={true} visible={notificationModalVisible}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.mEmoji}>📢</Text>
            <Text style={styles.mTitle}>New Invitation!</Text>
            <Text style={styles.mBody}>{receivedData?.creator_name} is going for {receivedData?.meal_type}. Coming?</Text>
            <View style={styles.mButtons}>
              <TouchableOpacity style={[styles.mBtn, { backgroundColor: '#51CF66' }]} onPress={() => handleRSVP('join')}>
                <Text style={styles.mBtnText}>Join</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.mBtn, { backgroundColor: '#F1F3F5', marginLeft: 10 }]} onPress={() => handleRSVP('not_coming')}>
                <Text style={[styles.mBtnText, { color: '#333' }]}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#F8F9FA', justifyContent: 'center', padding: 25 },
  scrollContainer: { padding: 20 },
  onboardingCard: { backgroundColor: 'white', borderRadius: 30, padding: 35, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, elevation: 10 },
  logoBadge: { width: 80, height: 80, borderRadius: 25, backgroundColor: '#FFF5F5', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  logoEmoji: { fontSize: 40 },
  titleText: { fontSize: 26, fontWeight: '800', color: '#212529', marginBottom: 10 },
  subtitleText: { fontSize: 16, color: '#868E96', textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  inputField: { width: '100%', backgroundColor: '#F8F9FA', height: 60, borderRadius: 15, paddingHorizontal: 20, fontSize: 16, color: '#212529', marginBottom: 20, borderWidth: 1, borderColor: '#E9ECEF' },
  primaryButton: { width: '100%', backgroundColor: '#FF6B6B', height: 60, borderRadius: 15, justifyContent: 'center', alignItems: 'center', shadowColor: '#FF6B6B', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  primaryButtonText: { color: 'white', fontSize: 18, fontWeight: '700' },
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, marginTop: 10 },
  welcomeText: { fontSize: 28, fontWeight: '800', color: '#212529' },
  statusSub: { fontSize: 16, color: '#868E96' },
  profileCircle: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#FF6B6B', justifyContent: 'center', alignItems: 'center' },
  profileText: { color: 'white', fontWeight: 'bold', fontSize: 20 },
  sectionHeader: { fontSize: 18, fontWeight: '700', color: '#adb5bd', marginBottom: 15, letterSpacing: 1 },
  actionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 35 },
  actionCard: { flex: 1, backgroundColor: 'white', borderRadius: 20, padding: 15, marginHorizontal: 5, alignItems: 'center', borderWidth: 1, borderColor: '#F1F3F5', shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 10, elevation: 2 },
  emojiBg: { width: 50, height: 50, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  cardEmoji: { fontSize: 24 },
  cardLabel: { fontSize: 13, fontWeight: '700', color: '#495057' },
  liveCard: { backgroundColor: '#212529', borderRadius: 30, padding: 25, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, elevation: 15 },
  liveTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#343A40', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, marginBottom: 15 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#51CF66', marginRight: 8 },
  tagText: { color: '#51CF66', fontSize: 10, fontWeight: '900' },
  liveContent: { marginBottom: 25 },
  liveMealTitle: { color: 'white', fontSize: 24, fontWeight: '800' },
  liveTime: { color: '#ADB5BD', marginTop: 4 },
  rsvpStack: { flexDirection: 'column', gap: 10, marginBottom: 25 },
  rsvpBtn: { height: 55, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  btnIn: { borderColor: '#51CF6620', backgroundColor: '#51CF6610' },
  btnOut: { borderColor: '#FF6B6B20', backgroundColor: '#FF6B6B10' },
  activeIn: { backgroundColor: '#51CF66', borderColor: '#51CF66' },
  activeOut: { backgroundColor: '#FF6B6B', borderColor: '#FF6B6B' },
  rsvpBtnText: { fontWeight: '700', fontSize: 16 },
  guestList: { gap: 20 },
  guestSection: {},
  guestTitle: { color: 'white', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  guestBadge: { backgroundColor: '#51CF6620', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  badgeText: { color: '#51CF66', fontSize: 12, fontWeight: '700' },
  emptyGuest: { color: '#495057', fontSize: 13, fontStyle: 'italic' },
  emptyStateContainer: { alignItems: 'center', marginTop: 40 },
  emptyIcon: { fontSize: 60, marginBottom: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#ADB5BD' },
  emptyText: { color: '#CED4DA', textAlign: 'center', marginTop: 5 },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 30 },
  modal: { backgroundColor: 'white', borderRadius: 25, padding: 30, alignItems: 'center' },
  mEmoji: { fontSize: 40, marginBottom: 15 },
  mTitle: { fontSize: 22, fontWeight: '800', marginBottom: 10 },
  mBody: { color: '#868E96', textAlign: 'center', fontSize: 16, marginBottom: 25 },
  mButtons: { flexDirection: 'row', width: '100%' },
  mBtn: { flex: 1, height: 55, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  mBtnText: { color: 'white', fontWeight: '700', fontSize: 16 }
});
