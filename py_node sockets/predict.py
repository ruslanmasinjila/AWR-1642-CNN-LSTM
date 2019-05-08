# Loads preTRained CNN-LSTM Neural Network
# Performs prediction
import tensorflow as tf
import numpy as np
from tensorflow.keras.models import load_model



class Predict():
    
    def __init__(self):
        self.frame_rate=16
        self.num_doppler_bins=16
        self.num_range_bins=64
        
        ####################### LOAD PRETRAINED CNN-LSTM MODEL #######################
        self.model = load_model('model.h5')
        #self.model._make_predict_function()
        print("Pretrained CNN-LSTM model loaded successfully")
        print("Summary of the model is as follows")
        print(self.model.summary())
        
    def predictGesture(self,frame_sequence):
        frame_sequence=np.array(frame_sequence).reshape(1,self.frame_rate,self.num_doppler_bins,self.num_range_bins,1)
        print(frame_sequence)
        result = self.model.predict(frame_sequence)
        print(result)
